// Integration API v1 — for ERPs and other systems to sync customers, stores (branches) and spaces.
//
//   Authorization: Bearer sos_<prefix>_<secret>      (Settings → Integrations)
//
// Records are identified by YOUR ids (external_id). Sending a record again updates it (idempotent upsert);
// only the fields you send are changed, and `null` clears a field. Batches: up to 1000 items, one result per item.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { z, ZodError } from 'zod';
import { decodeCursor, encodeCursor, sql, withTenant, type Tx } from '../db.js';
import { planBlocks } from '../billing.js';
import { isValidAfm } from './customers.js';
import { openApiSpec } from './integration-openapi.js';
import { emitEntityEvents, hasWebhooks, emitEvents, type EventSource } from '../webhooks.js';
import { customInput } from '../forms.js';
import { branchOut, customerOut, spaceOut } from '../readmodels.js';
import { activityOut, emitActivityEvents, insertActivity } from '../crm.js';
import { docOut } from './documents.js';
import { openFile } from '../storage.js';
import { ALL_LISTS, canonicalName, isNameList, nameInUse, renameInRecords, type NameList } from '../lookups.js';

/** Name-list fields: unknown values are added to the list (like zones), and the list's spelling is stored. */
async function listNames(sp: Tx, T: string, cols: Record<string, unknown>, fields: [string, NameList][], cache: Map<string, string>) {
  for (const [field, list] of fields) {
    if (cols[field] !== undefined) cols[field] = await canonicalName(sp, T, list, cols[field] as string | null, { create: true, cache });
  }
}
import type postgres from 'postgres';

type Frag = postgres.PendingQuery<postgres.Row[]>;

type Resource = 'customers' | 'branches' | 'spaces' | 'lists' | 'activities' | 'documents';
type Level = 'none' | 'read' | 'write';
type ApiKeyCtx = { id: string; tenantId: string; name: string; permissions: Record<Resource, Level>; expiresAt: number | null; ips: BlockList | null };
type ApiLog = { tenantId?: string; keyId?: string; items?: number; created?: number; updated?: number; failed?: number; error?: string; errors?: unknown };
declare module 'fastify' { interface FastifyRequest { apiKey?: ApiKeyCtx; apiLog?: ApiLog } }

const MAX_BATCH = 1000;
const RATE_PER_MIN = 1200;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- auth & rate limit
const keyCache = new Map<string, { ctx: ApiKeyCtx | null; hash: string; at: number }>();
const usage = new Map<string, { n: number; flushedAt: number }>();
const buckets = new Map<string, { tokens: number; at: number }>();

function problem(reply: FastifyReply, status: number, error: string, detail?: unknown) {
  const log = (reply.request.apiLog ??= {});
  log.error = error;
  return reply.code(status).send({ error, ...(detail !== undefined ? { detail } : {}) });
}

/** "1.2.3.4", "10.0.0.0/8", "2001:db8::/32" → BlockList (null = any address). */
export function parseIpList(list: string[]): BlockList | null {
  if (!list.length) return null;
  const b = new BlockList();
  for (const raw of list) {
    const [addr, bits] = raw.trim().split('/');
    const type = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    if (bits !== undefined) b.addSubnet(addr, Number(bits), type);
    else b.addAddress(addr, type);
  }
  return b;
}
export function validIpEntry(raw: string) {
  const [addr, bits, extra] = raw.trim().split('/');
  const v = isIP(addr);
  if (!v || extra !== undefined) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return /^[0-9]+$/.test(bits) && n >= 0 && n <= (v === 6 ? 128 : 32);
}
function ipAllowed(list: BlockList, ip: string) {
  const a = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return list.check(a, isIP(a) === 6 ? 'ipv6' : 'ipv4');
}

async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const m = /^Bearer\s+sos_([a-f0-9]{12})_([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
  if (!m) return problem(reply, 401, 'unauthorized', 'Missing or malformed API key (Authorization: Bearer sos_…)');
  const [, prefix, secret] = m;
  let hit = keyCache.get(prefix);
  if (!hit || Date.now() - hit.at > 60_000) {
    // Cross-tenant lookup by prefix with the owner connection; the tenant comes from the key itself.
    const [k] = await sql`SELECT id, tenant_id, name, secret_hash, revoked_at, permissions, expires_at, allowed_ips FROM api_keys WHERE prefix = ${prefix}`;
    hit = {
      ctx: k && !k.revoked_at ? {
        id: k.id, tenantId: k.tenant_id, name: k.name, permissions: k.permissions,
        expiresAt: k.expires_at ? new Date(k.expires_at).getTime() : null, ips: parseIpList(k.allowed_ips ?? []),
      } : null,
      hash: k?.secret_hash ?? '', at: Date.now(),
    };
    keyCache.set(prefix, hit);
  }
  const given = Buffer.from(sha256(secret), 'hex');
  const stored = Buffer.from(hit.hash.padEnd(64, '0'), 'hex');
  if (!hit.ctx || given.length !== stored.length || !timingSafeEqual(given, stored)) return problem(reply, 401, 'unauthorized', 'Invalid or revoked API key');
  const ctx = hit.ctx;
  req.apiLog = { tenantId: ctx.tenantId, keyId: ctx.id };
  if (ctx.expiresAt !== null && ctx.expiresAt <= Date.now()) return problem(reply, 401, 'key_expired', 'This API key has expired');
  const pb = await planBlocks(ctx.tenantId, 'api');
  if (pb) return problem(reply, 402, pb, pb === 'plan_feature' ? 'The subscription plan does not include the integration API' : 'The subscription is not active');
  if (ctx.ips && !ipAllowed(ctx.ips, req.ip)) return problem(reply, 403, 'ip_not_allowed', `Requests from ${req.ip} are not allowed for this key`);

  // Token bucket per key
  const b = buckets.get(prefix) ?? { tokens: RATE_PER_MIN, at: Date.now() };
  b.tokens = Math.min(RATE_PER_MIN, b.tokens + ((Date.now() - b.at) / 60_000) * RATE_PER_MIN);
  b.at = Date.now();
  if (b.tokens < 1) {
    buckets.set(prefix, b);
    reply.header('Retry-After', '5');
    return problem(reply, 429, 'rate_limited', `Max ${RATE_PER_MIN} requests per minute per key`);
  }
  b.tokens -= 1;
  buckets.set(prefix, b);
  reply.header('X-RateLimit-Limit', String(RATE_PER_MIN));
  reply.header('X-RateLimit-Remaining', String(Math.floor(b.tokens)));

  // Usage counter (flushed at most every 30s per key)
  const u = usage.get(ctx.id) ?? { n: 0, flushedAt: 0 };
  u.n++;
  if (Date.now() - u.flushedAt > 30_000) {
    const n = u.n;
    u.n = 0; u.flushedAt = Date.now();
    sql`UPDATE api_keys SET last_used_at = now(), requests = requests + ${n} WHERE id = ${ctx.id}`.catch(() => {});
  }
  usage.set(ctx.id, u);
  req.apiKey = ctx;
}

/** Per-resource permission: read for GET, write for changes ("write" includes read). */
const need = (req: FastifyRequest, reply: FastifyReply, res: Resource, level: 'read' | 'write') => {
  const has = req.apiKey?.permissions?.[res] ?? 'none';
  if (has === 'write' || has === level) return true;
  problem(reply, 403, 'forbidden', `This API key has no ${level} access to ${res}`);
  return false;
};

// ---------------------------------------------------------------- request log (buffered, flushed every second)
let logBuffer: Record<string, unknown>[] = [];
let flushTimer: NodeJS.Timeout | null = null;
async function flushLog() {
  flushTimer = null;
  const rows = logBuffer;
  logBuffer = [];
  if (rows.length) await sql`INSERT INTO api_requests ${sql(rows as never)}`.catch((e: Error) => console.error('api log flush failed', e.message));
}
function logRequest(req: FastifyRequest, reply: FastifyReply) {
  const l = req.apiLog;
  if (!l?.tenantId) return; // unknown key: nothing to attribute it to
  logBuffer.push({
    tenant_id: l.tenantId, key_id: l.keyId ?? null, method: req.method, path: (req.url.split('?')[0] ?? '').slice(0, 300),
    status: reply.statusCode, duration_ms: Math.round(reply.elapsedTime), ip: req.ip ?? null,
    items: l.items ?? null, created: l.created ?? null, updated: l.updated ?? null, failed: l.failed ?? null,
    error: l.error ?? null, errors: l.errors ? sql.json(l.errors as never) : null,
  });
  if (logBuffer.length >= 500) void flushLog();
  else flushTimer ??= setTimeout(() => void flushLog(), 1000);
}

const src = (k: ApiKeyCtx): EventSource => ({ type: 'api', key: k.name });
const ENTITY = { customers: 'customer', branches: 'branch', spaces: 'space' } as const;

/** Revoked keys stop working immediately on this instance. */
export function forgetApiKey(prefix: string) { keyCache.delete(prefix); }

// ---------------------------------------------------------------- schemas
const ext = z.string().trim().min(1).max(100);
const str = (max: number) => z.string().trim().max(max).nullable().optional();
const STATUSES = ['active', 'prospect', 'negotiation', 'inactive'] as const;

const customerIn = z.object({
  external_id: ext,
  code: z.string().trim().min(1).max(40).optional(),
  kind: z.enum(['company', 'group']).optional(),
  name: z.string().trim().min(2).max(200).optional(),
  trade_name: str(200), vat: str(20), tax_office: str(100), gemi: str(30), activity: str(200),
  status: z.enum(STATUSES).optional(), category: str(60),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  source: str(60),
  parent_external_id: ext.nullable().optional(),
  account_manager_email: z.string().trim().toLowerCase().email().nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: str(40), mobile: str(40), website: str(200),
  address: z.object({ street: str(200), city: str(100), postal: str(20), region: str(100), country: z.string().trim().length(2).optional() }).optional(),
  geo_zone: str(80),
  payment_terms: str(40),
  credit_limit: z.number().min(0).max(1e12).nullable().optional(),
  discount: z.number().min(0).max(100).optional(),
  annual_value: z.number().min(0).max(1e13).optional(),
  notes: str(10000),
  custom: z.record(z.string().max(40), z.unknown()).optional(),
}).strict();

const branchIn = z.object({
  external_id: ext,
  customer_external_id: ext.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  trade_name: str(200), address: str(200), city: str(100), postal_code: str(20), region: str(100),
  phone: str(40), manager_name: str(120),
  status: z.enum(['active', 'inactive']).optional(),
  geo_zone: str(80), fee_schedule: str(80), tour: str(80), ongoing_status: str(80),
  seasonality: z.enum(['all_year', 'summer', 'winter', 'custom']).optional(),
  season_months: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  custom: z.record(z.string().max(40), z.unknown()).optional(),
}).strict();

const spaceIn = z.object({
  external_id: ext,
  branch_external_id: ext.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: str(80),
  area_sqm: z.number().min(0).max(1e7).nullable().optional(),
  notes: str(2000),
  custom: z.record(z.string().max(40), z.unknown()).optional(),
}).strict();

type ItemResult = { external_id: string; status: 'created' | 'updated' | 'error'; id?: string; error?: string; detail?: unknown };
class RowError extends Error { constructor(public code: string, public detail?: unknown) { super(code); } }

/** Only keys actually sent (undefined = untouched, null = clear). */
function pick<T extends Record<string, unknown>>(o: T, keys: (keyof T)[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k as string] = o[k];
  return out;
}

// Value lists are referenced by name; missing values are created (per batch cache)
type LookupList = 'geo_zone' | 'fee_schedule' | 'tour' | 'ongoing_status';
async function lookupId(tx: Tx, tenantId: string, list: LookupList, name: string | null | undefined, cache: Map<string, string>) {
  if (name === undefined) return undefined;
  if (name === null || name === '') return null;
  const k = `${list}:${name.toLowerCase()}`;
  if (cache.has(k)) return cache.get(k)!;
  const [found] = await tx`SELECT id FROM lookup_values WHERE tenant_id = ${tenantId} AND list = ${list} AND search_key(name) = search_key(${name})`;
  let id = found?.id as string | undefined;
  if (!id) {
    const [{ next }] = await tx`SELECT coalesce(max(sort), 0) + 1 AS next FROM lookup_values WHERE tenant_id = ${tenantId} AND list = ${list}`;
    [{ id }] = await tx`INSERT INTO lookup_values (tenant_id, list, name, sort) VALUES (${tenantId}, ${list}, ${name}, ${next}) RETURNING id`;
  }
  cache.set(k, id!);
  return id!;
}

/** Custom field values (Settings → Module Forms) of an API row: merged into the stored ones, null clears a key. */
async function customCols(sp: Tx, T: string, form: 'customer' | 'branch' | 'space' | 'activity', incoming: Record<string, unknown> | undefined, cols: Record<string, unknown>) {
  const c = await customInput(sp, T, form, incoming);
  if (!c) return;
  if (Object.keys(c.errors).length) throw new RowError('invalid_custom_fields', c.errors);
  cols.custom = sp`(coalesce(custom, '{}'::jsonb) || ${sp.json(c.set as never)}::jsonb) - ${c.remove}::text[]`;
}
/** For INSERT: the expression above needs an existing row; new rows get the object itself. */
const insertCustom = (sp: Tx, cols: Record<string, unknown>, incoming: Record<string, unknown> | undefined) => {
  if (cols.custom === undefined) return cols;
  const clean = Object.fromEntries(Object.entries(incoming ?? {}).filter(([, v]) => v !== null && v !== ''));
  return { ...cols, custom: sp.json(clean as never) };
};

const zodDetail = (e: ZodError) => e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** Runs each item in its own savepoint: a bad row is reported and the rest of the batch continues. */
async function runBatch<T>(tx: Tx, items: unknown[], schema: z.ZodType<T>, fn: (row: T, sp: Tx) => Promise<Omit<ItemResult, 'external_id'>>,
  idOf: (raw: unknown) => string = (raw) => (typeof (raw as { external_id?: unknown })?.external_id === 'string' ? (raw as { external_id: string }).external_id : '')) {
  const results: ItemResult[] = [];
  for (const raw of items) {
    const externalId = idOf(raw);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) { results.push({ external_id: externalId, status: 'error', error: 'validation', detail: zodDetail(parsed.error) }); continue; }
    try {
      const r = await tx.savepoint((sp) => fn(parsed.data, sp as unknown as Tx));
      results.push({ external_id: externalId, ...r });
    } catch (e) {
      if (e instanceof RowError) results.push({ external_id: externalId, status: 'error', error: e.code, detail: e.detail });
      else if ((e as { code?: string }).code === '23505') results.push({ external_id: externalId, status: 'error', error: 'duplicate', detail: (e as { detail?: string }).detail });
      else throw e;
    }
  }
  return results;
}

const summary = (results: ItemResult[]) => ({
  created: results.filter((r) => r.status === 'created').length,
  updated: results.filter((r) => r.status === 'updated').length,
  failed: results.filter((r) => r.status === 'error').length,
  results,
});

async function refreshCounters(tx: Tx, branchIds: Set<string>, customerIds: Set<string>, parentIds: Set<string>) {
  if (branchIds.size) {
    await tx`UPDATE branches b SET spaces_count = (SELECT count(*) FROM spaces s WHERE s.branch_id = b.id) WHERE b.id = ANY(${[...branchIds]}::uuid[])`;
  }
  if (customerIds.size) {
    await tx`
      UPDATE customers c SET
        branches_count = (SELECT count(*) FROM branches b WHERE b.customer_id = c.id),
        spaces_count   = (SELECT coalesce(sum(spaces_count), 0) FROM branches b WHERE b.customer_id = c.id)
      WHERE c.id = ANY(${[...customerIds]}::uuid[])`;
  }
  if (parentIds.size) {
    await tx`UPDATE customers c SET companies_count = (SELECT count(*) FROM customers ch WHERE ch.parent_id = c.id AND ch.archived_at IS NULL)
             WHERE c.id = ANY(${[...parentIds]}::uuid[])`;
  }
}

async function audit(tx: Tx, key: ApiKeyCtx, action: string, details: unknown) {
  await tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, details) VALUES (${key.tenantId}, NULL, ${action}, ${`API: ${key.name}`}, ${tx.json(details as never)})`;
}

// ---------------------------------------------------------------- upserts
/** Hands out customer codes from blocks reserved in one query (instead of one counter round trip per row). */
function codeAllocator(tx: Tx, tenantId: string) {
  let pool: string[] = [];
  return async () => {
    for (let guard = 0; pool.length === 0 && guard < 20; guard++) {
      const [{ value }] = await tx`
        INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${tenantId}, 'customer_seq', 100)
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 100 RETURNING value`;
      const block = Array.from({ length: 100 }, (_, i) => `CUST-${String(Number(value) - 99 + i).padStart(6, '0')}`);
      const taken = new Set((await tx`SELECT code FROM customers WHERE tenant_id = ${tenantId} AND code = ANY(${block})`).map((r) => r.code as string));
      pool = block.filter((c) => !taken.has(c));
    }
    const code = pool.shift();
    if (!code) throw new RowError('code_exhausted');
    return code;
  };
}

async function upsertCustomers(tx: Tx, key: ApiKeyCtx, items: unknown[]) {
  const T = key.tenantId;
  const cache = new Map<string, string>();
  const parents = new Set<string>();
  const createdIds: string[] = [];
  const nextCode = codeAllocator(tx, T);
  // Prefetch which external ids already exist (one query instead of one per row)
  const ids = [...new Set(items.map((x) => (x as { external_id?: unknown })?.external_id).filter((x): x is string => typeof x === 'string'))];
  const known = new Map<string, { id: string; parent_id: string | null }>(
    (await tx`SELECT external_id, id, parent_id FROM customers WHERE tenant_id = ${T} AND external_id = ANY(${ids})`)
      .map((r) => [r.external_id as string, { id: r.id as string, parent_id: r.parent_id as string | null }]),
  );
  const results = await runBatch(tx, items, customerIn, async (c, sp) => {
    if (c.vat && (c.address?.country ?? 'GR') === 'GR' && !isValidAfm(c.vat)) throw new RowError('invalid_afm');
    const cols: Record<string, unknown> = pick(c, ['kind', 'name', 'trade_name', 'vat', 'tax_office', 'gemi', 'activity', 'status', 'category', 'tags',
      'source', 'email', 'phone', 'mobile', 'website', 'payment_terms', 'credit_limit', 'discount', 'annual_value', 'notes', 'code']);
    if (c.address) {
      Object.assign(cols, pick({ address_street: c.address.street, address_city: c.address.city, address_postal: c.address.postal,
        address_region: c.address.region, address_country: c.address.country }, ['address_street', 'address_city', 'address_postal', 'address_region', 'address_country']));
    }
    const zone = await lookupId(sp, T, 'geo_zone', c.geo_zone, cache);
    if (zone !== undefined) cols.geo_zone_id = zone;
    await listNames(sp, T, cols, [['category', 'customer_category'], ['source', 'customer_source'], ['payment_terms', 'payment_terms'], ['address_region', 'prefecture']], cache);
    if (c.parent_external_id !== undefined) {
      if (c.parent_external_id === null) cols.parent_id = null;
      else {
        const [p] = await sp`SELECT id, kind FROM customers WHERE tenant_id = ${T} AND external_id = ${c.parent_external_id}`;
        if (!p) throw new RowError('parent_not_found', c.parent_external_id);
        if (p.kind !== 'group') throw new RowError('parent_not_group', c.parent_external_id);
        cols.parent_id = p.id;
        parents.add(p.id);
      }
    }
    if (c.account_manager_email !== undefined) {
      if (c.account_manager_email === null) cols.account_manager_id = null;
      else {
        const [u] = await sp`SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${T} AND lower(u.email) = ${c.account_manager_email}`;
        if (!u) throw new RowError('account_manager_not_found', c.account_manager_email);
        cols.account_manager_id = u.user_id;
      }
    }
    if (c.code) {
      const [taken] = await sp`SELECT 1 FROM customers WHERE tenant_id = ${T} AND code = ${c.code} AND external_id IS DISTINCT FROM ${c.external_id}`;
      if (taken) throw new RowError('code_taken', c.code);
    }
    await customCols(sp, T, 'customer', c.custom, cols);

    const existing = known.get(c.external_id);
    if (existing) {
      if (cols.parent_id === existing.id) throw new RowError('parent_is_self');
      if (existing.parent_id) parents.add(existing.parent_id);
      if (Object.keys(cols).length) await sp`UPDATE customers SET ${sp(cols)}, updated_at = now() WHERE id = ${existing.id}`;
      return { status: 'updated', id: existing.id };
    }
    if (!c.name) throw new RowError('name_required', 'name is required when creating a customer');
    const [row] = await sp`
      INSERT INTO customers ${sp({ ...insertCustom(sp, cols, c.custom), tenant_id: T, external_id: c.external_id, code: c.code ?? (await nextCode()) })}
      RETURNING id`;
    known.set(c.external_id, { id: row.id, parent_id: (cols.parent_id as string | null) ?? null }); // same id again in this batch = update
    createdIds.push(row.id);
    return { status: 'created', id: row.id };
  });
  // History entry for every created customer, in one statement
  if (createdIds.length) {
    await tx`INSERT INTO activities (tenant_id, customer_id, kind, title, body)
             SELECT ${T}, id, 'note', 'Δημιουργία πελάτη (API)', ${key.name} FROM unnest(${createdIds}::uuid[]) AS id`;
  }
  await refreshCounters(tx, new Set(), new Set(), parents);
  return results;
}

async function upsertBranches(tx: Tx, key: ApiKeyCtx, items: unknown[]) {
  const T = key.tenantId;
  const cache = new Map<string, string>();
  const customers = new Set<string>();
  const results = await runBatch(tx, items, branchIn, async (b, sp) => {
    const cols: Record<string, unknown> = pick(b, ['name', 'trade_name', 'address', 'city', 'postal_code', 'region', 'phone', 'manager_name', 'status', 'seasonality']);
    for (const [field, list] of [['geo_zone', 'geo_zone'], ['fee_schedule', 'fee_schedule'], ['tour', 'tour'], ['ongoing_status', 'ongoing_status']] as const) {
      const id = await lookupId(sp, T, list, b[field], cache);
      if (id !== undefined) cols[`${field}_id`] = id;
    }
    await listNames(sp, T, cols, [['region', 'prefecture']], cache);
    if (b.season_months !== undefined) cols.season_months = sp.array([...new Set(b.season_months)].sort((x, y) => x - y), 21);
    if (b.seasonality && b.seasonality !== 'custom') cols.season_months = sp.array([], 21);
    if (b.customer_external_id) {
      const [c] = await sp`SELECT id FROM customers WHERE tenant_id = ${T} AND external_id = ${b.customer_external_id}`;
      if (!c) throw new RowError('customer_not_found', b.customer_external_id);
      cols.customer_id = c.id;
      customers.add(c.id);
    }
    await customCols(sp, T, 'branch', b.custom, cols);
    const [existing] = await sp`SELECT id, customer_id FROM branches WHERE tenant_id = ${T} AND external_id = ${b.external_id}`;
    if (existing) {
      customers.add(existing.customer_id);
      if (Object.keys(cols).length) await sp`UPDATE branches SET ${sp(cols)}, updated_at = now() WHERE id = ${existing.id}`;
      return { status: 'updated', id: existing.id };
    }
    if (!cols.customer_id) throw new RowError('customer_external_id_required');
    if (!b.name) throw new RowError('name_required', 'name is required when creating a store');
    const [row] = await sp`INSERT INTO branches ${sp({ ...insertCustom(sp, cols, b.custom), tenant_id: T, external_id: b.external_id })} RETURNING id`;
    return { status: 'created', id: row.id };
  });
  await refreshCounters(tx, new Set(), customers, new Set());
  return results;
}

async function upsertSpaces(tx: Tx, key: ApiKeyCtx, items: unknown[]) {
  const T = key.tenantId;
  const branchIds = new Set<string>();
  const cache = new Map<string, string>();
  const results = await runBatch(tx, items, spaceIn, async (s, sp) => {
    const cols: Record<string, unknown> = pick(s, ['name', 'kind', 'area_sqm', 'notes']);
    await listNames(sp, T, cols, [['kind', 'space_kind']], cache);
    if (s.branch_external_id) {
      const [b] = await sp`SELECT id FROM branches WHERE tenant_id = ${T} AND external_id = ${s.branch_external_id}`;
      if (!b) throw new RowError('branch_not_found', s.branch_external_id);
      cols.branch_id = b.id;
      branchIds.add(b.id);
    }
    await customCols(sp, T, 'space', s.custom, cols);
    const [existing] = await sp`SELECT id, branch_id FROM spaces WHERE tenant_id = ${T} AND external_id = ${s.external_id}`;
    if (existing) {
      branchIds.add(existing.branch_id);
      if (Object.keys(cols).length) await sp`UPDATE spaces SET ${sp(cols)}, updated_at = now() WHERE id = ${existing.id}`;
      return { status: 'updated', id: existing.id };
    }
    if (!cols.branch_id) throw new RowError('branch_external_id_required');
    if (!s.name) throw new RowError('name_required', 'name is required when creating a space');
    const [row] = await sp`INSERT INTO spaces ${sp({ ...insertCustom(sp, cols, s.custom), tenant_id: T, external_id: s.external_id })} RETURNING id`;
    return { status: 'created', id: row.id };
  });
  const customers = branchIds.size
    ? new Set((await tx`SELECT DISTINCT customer_id FROM branches WHERE id = ANY(${[...branchIds]}::uuid[])`).map((r) => r.customer_id as string))
    : new Set<string>();
  await refreshCounters(tx, branchIds, customers, new Set());
  return results;
}

// ---------------------------------------------------------------- CRM activities
const activityIn = z.object({
  external_id: ext,
  type: z.string().trim().min(1).max(40).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: str(20000),
  status: z.enum(['planned', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.number().int().min(1).max(3).optional(),
  due_at: z.coerce.date().nullable().optional(),
  duration_min: z.number().int().min(0).max(10080).optional(),
  all_day: z.boolean().optional(),
  location: str(300),
  owner_email: z.string().trim().toLowerCase().email().nullable().optional(),
  customer_external_id: ext.nullable().optional(),
  outcome: str(40), outcome_note: str(5000),
  remind_before_min: z.number().int().min(0).max(10080).nullable().optional(),
  custom: z.record(z.string().max(40), z.unknown()).optional(),
}).strict();

async function upsertActivities(tx: Tx, key: ApiKeyCtx, items: unknown[]) {
  const T = key.tenantId;
  const types = new Set((await tx`SELECT key FROM crm_activity_types WHERE tenant_id = ${T}`).map((r) => r.key as string));
  const outcomes = new Set((await tx`SELECT key FROM crm_outcomes WHERE tenant_id = ${T}`).map((r) => r.key as string));
  return runBatch(tx, items, activityIn, async (a, sp) => {
    const cols: Record<string, unknown> = pick(a, ['type', 'subject', 'body', 'status', 'priority', 'due_at', 'duration_min', 'all_day', 'location', 'outcome', 'outcome_note', 'remind_before_min']);
    if (a.type && !types.has(a.type)) throw new RowError('invalid_type', a.type);
    if (a.outcome && !outcomes.has(a.outcome)) throw new RowError('invalid_outcome', a.outcome);
    if (a.owner_email !== undefined) {
      if (a.owner_email === null) cols.owner_id = null;
      else {
        const [u] = await sp`SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${T} AND lower(u.email) = ${a.owner_email}`;
        if (!u) throw new RowError('owner_not_found', a.owner_email);
        cols.owner_id = u.user_id;
      }
    }
    if (a.customer_external_id !== undefined) {
      if (a.customer_external_id === null) cols.customer_id = null;
      else {
        const [c] = await sp`SELECT id FROM customers WHERE tenant_id = ${T} AND external_id = ${a.customer_external_id}`;
        if (!c) throw new RowError('customer_not_found', a.customer_external_id);
        cols.customer_id = c.id;
      }
    }
    if (a.status === 'done') { cols.completed_at = sp`coalesce(completed_at, now())`; cols.remind_at = null; }
    else if (a.status) { cols.completed_at = null; cols.completed_by = null; }
    if (a.due_at !== undefined || a.remind_before_min !== undefined) {
      cols.remind_at = sp`CASE WHEN ${a.remind_before_min ?? null}::int IS NULL AND remind_before_min IS NULL THEN NULL
        ELSE coalesce(${a.due_at ?? null}::timestamptz, due_at) - (coalesce(${a.remind_before_min ?? null}::int, remind_before_min) * interval '1 minute') END`;
      cols.reminded = false;
    }
    await customCols(sp, T, 'activity', a.custom, cols);
    const [existing] = await sp`SELECT id FROM crm_activities WHERE tenant_id = ${T} AND external_id = ${a.external_id}`;
    if (existing) {
      if (Object.keys(cols).length) await sp`UPDATE crm_activities SET ${sp(cols)}, updated_at = now() WHERE id = ${existing.id}`;
      return { status: 'updated', id: existing.id };
    }
    if (!a.type || !a.subject) throw new RowError('type_and_subject_required');
    const [id] = await insertActivity(sp, T, (cols.owner_id as string) ?? null, {
      type: a.type, subject: a.subject, body: a.body ?? null, status: a.status, priority: a.priority, due_at: a.due_at ?? null,
      duration_min: a.duration_min, all_day: a.all_day, location: a.location ?? null, owner_id: (cols.owner_id as string) ?? null,
      customer_id: (cols.customer_id as string) ?? null, outcome: a.outcome ?? null, outcome_note: a.outcome_note ?? null,
      remind_before_min: a.remind_before_min ?? null, external_id: a.external_id,
      custom: Object.fromEntries(Object.entries(a.custom ?? {}).filter(([, v]) => v !== null && v !== '')),
    });
    return { status: 'created', id };
  });
}

// Read models (shared with the webhook payloads): see ../readmodels.ts

const listQuery = z.object({
  updated_since: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ---------------------------------------------------------------- routes
export default async function integrationRoutes(app: FastifyInstance) {
  app.get('/v1/openapi.json', async () => openApiSpec);

  await app.register(async (r) => {
    r.addHook('preHandler', authenticate);
    r.addHook('onResponse', async (req, reply) => logRequest(req, reply));
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof ZodError) return problem(reply, 400, 'validation', zodDetail(err));
      const code = (err as { statusCode?: number }).statusCode;
      if (code && code < 500) return problem(reply, code, (err as Error).message);
      r.log.error(err);
      return problem(reply, 500, 'internal');
    });

    r.get('/v1/ping', async (req) => {
      const [t] = await sql`SELECT name FROM tenants WHERE id = ${req.apiKey!.tenantId}`;
      const k = req.apiKey!;
      return { ok: true, tenant: t.name, key: k.name, permissions: k.permissions, expires_at: k.expiresAt ? new Date(k.expiresAt).toISOString() : null };
    });

    // ----- generic list/get helpers (keyset on updated_at, id → incremental sync)
    const resourceOf = (path: string) => path.split('/')[2] as Resource;
    const list = (path: string, base: (tx: Tx, T: string) => Frag, alias: string, filters?: (q: Record<string, string>, tx: Tx) => Frag) =>
      r.get(path, async (req, reply) => {
        if (!need(req, reply, resourceOf(path), 'read')) return;
        const q = listQuery.parse(req.query);
        const extra = req.query as Record<string, string>;
        const cur = decodeCursor<[string, string]>(q.cursor);
        const T = req.apiKey!.tenantId;
        return withTenant(T, async (tx) => {
          const rows = await tx`
            ${base(tx, T)}
            ${q.updated_since ? tx`AND ${tx(alias)}.updated_at >= ${q.updated_since}` : tx``}
            ${filters ? filters(extra, tx) : tx``}
            ${cur ? tx`AND (${tx(alias)}.updated_at, ${tx(alias)}.id) > (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
            ORDER BY ${tx(alias)}.updated_at, ${tx(alias)}.id
            LIMIT ${q.limit + 1}`;
          const more = rows.length > q.limit;
          const items = more ? rows.slice(0, q.limit) : rows;
          const l = items.at(-1);
          return { items: items.map(({ id: _id, ...x }) => x), next_cursor: more && l ? encodeCursor([l.updated_at, l.id]) : null };
        });
      });

    list('/v1/customers', customerOut, 'c');
    list('/v1/branches', branchOut, 'b', (q, tx) => (q.customer_external_id ? tx`AND c.external_id = ${q.customer_external_id}` : tx``));
    list('/v1/spaces', spaceOut, 's', (q, tx) => (q.branch_external_id ? tx`AND b.external_id = ${q.branch_external_id}` : tx``));

    const getOne = (path: string, base: (tx: Tx, T: string) => Frag, alias: string) =>
      r.get(path, async (req, reply) => {
        if (!need(req, reply, resourceOf(path), 'read')) return;
        const { external_id } = z.object({ external_id: ext }).parse(req.params);
        const T = req.apiKey!.tenantId;
        const [row] = await withTenant(T, (tx) => tx`${base(tx, T)} AND ${tx(alias)}.external_id = ${external_id}`);
        if (!row) return problem(reply, 404, 'not_found');
        const { id: _id, ...out } = row;
        return out;
      });
    getOne('/v1/customers/:external_id', customerOut, 'c');
    getOne('/v1/branches/:external_id', branchOut, 'b');
    getOne('/v1/spaces/:external_id', spaceOut, 's');

    // By SoftifyOS id: records created in the app have no external_id (e.g. the id from a webhook)
    const getById = (path: string, base: (tx: Tx, T: string) => Frag, alias: string) =>
      r.get(path, async (req, reply) => {
        if (!need(req, reply, resourceOf(path), 'read')) return;
        const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
        if (!p.success) return problem(reply, 404, 'not_found');
        const T = req.apiKey!.tenantId;
        const [row] = await withTenant(T, (tx) => tx`${base(tx, T)} AND ${tx(alias)}.id = ${p.data.id}`);
        return row ?? problem(reply, 404, 'not_found');
      });
    getById('/v1/customers/by-id/:id', customerOut, 'c');
    getById('/v1/branches/by-id/:id', branchOut, 'b');
    getById('/v1/spaces/by-id/:id', spaceOut, 's');
    // CRM activities
    list('/v1/activities', activityOut, 'a', (q, tx) => tx`${q.customer_external_id ? tx`AND c.external_id = ${q.customer_external_id}` : tx``}
      ${q.status ? tx`AND a.status = ${q.status}` : tx``}`);
    getOne('/v1/activities/:external_id', activityOut, 'a');
    getById('/v1/activities/by-id/:id', activityOut, 'a');
    // Documents: metadata (incremental by updated_at) and the file itself
    r.get('/v1/documents', async (req, reply) => {
      if (!need(req, reply, 'documents', 'read')) return;
      const q = listQuery.extend({ customer_external_id: z.string().max(100).optional() }).parse(req.query);
      const cur = decodeCursor<[string, string]>(q.cursor);
      const T = req.apiKey!.tenantId;
      return withTenant(T, async (tx) => {
        const rows = await tx`${docOut(tx, T)}
          ${q.updated_since ? tx`AND d.updated_at >= ${q.updated_since}` : tx``}
          ${q.customer_external_id ? tx`AND c.external_id = ${q.customer_external_id}` : tx``}
          ${cur ? tx`AND (d.updated_at, d.id) > (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
          ORDER BY d.updated_at, d.id LIMIT ${q.limit + 1}`;
        const more = rows.length > q.limit;
        const items = more ? rows.slice(0, q.limit) : rows;
        const l = items.at(-1);
        return { items: items.map((x) => ({ ...x, file_url: `/api/v1/documents/by-id/${x.id}/file` })), next_cursor: more && l ? encodeCursor([l.updated_at, l.id]) : null };
      });
    });
    r.get('/v1/documents/by-id/:id/file', async (req, reply) => {
      if (!need(req, reply, 'documents', 'read')) return;
      const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
      if (!p.success) return problem(reply, 404, 'not_found');
      const T = req.apiKey!.tenantId;
      const [d] = await withTenant(T, (tx) => tx`SELECT storage_key, name, mime FROM documents WHERE id = ${p.data.id}`);
      if (!d) return problem(reply, 404, 'not_found');
      const f = await openFile(d.storage_key).catch(() => null);
      if (!f) return problem(reply, 410, 'file_missing');
      reply.header('Content-Type', d.mime).header('Content-Length', f.size).header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`);
      return reply.send(f.stream);
    });

    // ----- writes: single (PUT, idempotent) and batch (POST)
    const writers = [
      ['customers', upsertCustomers, 'api.customers'],
      ['branches', upsertBranches, 'api.branches'],
      ['spaces', upsertSpaces, 'api.spaces'],
      ['activities', upsertActivities, 'api.activities'],
    ] as const;
    for (const [entity, fn, action] of writers) {
      /** Webhook events for what the batch changed (same transaction → only committed changes are sent). */
      const emitFor = async (tx: Tx, key: ApiKeyCtx, out: ItemResult[], before?: Map<string, Record<string, unknown>>) => {
        for (const st of ['created', 'updated'] as const) {
          const ids = [...new Set(out.filter((x) => x.status === st && x.id).map((x) => x.id!))];
          if (entity === 'activities') await emitActivityEvents(tx, key.tenantId, st, ids, src(key));
          else await emitEntityEvents(tx, key.tenantId, ENTITY[entity], st, ids, src(key), st === 'updated' ? before : undefined);
        }
      };
      /** Rows as they were before the write (for changed_fields), by id. */
      const snapshot = async (tx: Tx, key: ApiKeyCtx, items: unknown[]) => {
        const ext = [...new Set(items.map((x) => (x as { external_id?: unknown })?.external_id).filter((x): x is string => typeof x === 'string'))];
        if (entity === 'activities' || !ext.length || !(await hasWebhooks(tx, key.tenantId))) return new Map<string, Record<string, unknown>>();
        const rows = await tx`SELECT * FROM ${tx(entity)} WHERE tenant_id = ${key.tenantId} AND external_id = ANY(${ext})`;
        return new Map(rows.map((r) => [r.id as string, r as Record<string, unknown>]));
      };
      const logResult = (req: FastifyRequest, out: ItemResult[]) => {
        const s = summary(out);
        req.apiLog = { ...req.apiLog, items: out.length, created: s.created, updated: s.updated, failed: s.failed,
          errors: s.failed ? out.filter((x) => x.status === 'error').slice(0, 20) : undefined };
      };

      r.put(`/v1/${entity}/:external_id`, { bodyLimit: 1_000_000 }, async (req, reply) => {
        if (!need(req, reply, entity, 'write')) return;
        const { external_id } = z.object({ external_id: ext }).parse(req.params);
        const body = { ...(req.body as object ?? {}), external_id };
        const key = req.apiKey!;
        const out = await withTenant(key.tenantId, async (tx) => {
          const before = await snapshot(tx, key, [body]);
          const o = await fn(tx, key, [body]);
          if (o[0].status !== 'error') {
            await audit(tx, key, `${action}.upsert`, { [o[0].status]: 1 });
            await emitFor(tx, key, o, before);
          }
          return o;
        });
        logResult(req, out);
        const [res] = out;
        if (res.status === 'error') { req.apiLog!.error = res.error; return reply.code(422).send(res); }
        return reply.code(res.status === 'created' ? 201 : 200).send(res);
      });

      r.post(`/v1/${entity}/batch`, { bodyLimit: 20_000_000 }, async (req, reply) => {
        if (!need(req, reply, entity, 'write')) return;
        const { items } = z.object({ items: z.array(z.unknown()).min(1).max(MAX_BATCH) }).parse(req.body);
        const key = req.apiKey!;
        const t0 = Date.now();
        const results = await withTenant(key.tenantId, async (tx) => {
          const before = await snapshot(tx, key, items);
          const out = await fn(tx, key, items);
          const s = summary(out);
          await audit(tx, key, `${action}.batch`, { created: s.created, updated: s.updated, failed: s.failed });
          await emitFor(tx, key, out, before);
          return out;
        });
        logResult(req, results);
        return { ...summary(results), duration_ms: Date.now() - t0 };
      });
    }

    // ----- deletes: customers are archived (history kept); stores/spaces are removed
    r.delete('/v1/customers/:external_id', async (req, reply) => {
      if (!need(req, reply, 'customers', 'write')) return;
      const { external_id } = z.object({ external_id: ext }).parse(req.params);
      const key = req.apiKey!;
      const ok = await withTenant(key.tenantId, async (tx) => {
        const [c] = await tx`UPDATE customers SET archived_at = coalesce(archived_at, now()), updated_at = now()
                             WHERE tenant_id = ${key.tenantId} AND external_id = ${external_id} RETURNING id, parent_id`;
        if (c?.parent_id) await refreshCounters(tx, new Set(), new Set(), new Set([c.parent_id]));
        if (c) await audit(tx, key, 'api.customers.archive', { external_id });
        if (c) await emitEntityEvents(tx, key.tenantId, 'customer', 'archived', [c.id], src(key));
        return !!c;
      });
      return ok ? { ok: true, archived: true } : problem(reply, 404, 'not_found');
    });

    r.delete('/v1/activities/:external_id', async (req, reply) => {
      if (!need(req, reply, 'activities', 'write')) return;
      const { external_id } = z.object({ external_id: ext }).parse(req.params);
      const key = req.apiKey!;
      const ok = await withTenant(key.tenantId, async (tx) => {
        const [a] = await tx`DELETE FROM crm_activities WHERE tenant_id = ${key.tenantId} AND external_id = ${external_id} RETURNING id`;
        if (a) { await audit(tx, key, 'api.activities.delete', { external_id }); await emitActivityEvents(tx, key.tenantId, 'deleted', [a.id], src(key)); }
        return !!a;
      });
      return ok ? { ok: true } : problem(reply, 404, 'not_found');
    });

    for (const entity of ['branches', 'spaces'] as const) {
      r.delete(`/v1/${entity}/:external_id`, async (req, reply) => {
        if (!need(req, reply, entity, 'write')) return;
        const { external_id } = z.object({ external_id: ext }).parse(req.params);
        const key = req.apiKey!;
        const ok = await withTenant(key.tenantId, async (tx) => {
          if (entity === 'branches') {
            const [b] = await tx`DELETE FROM branches WHERE tenant_id = ${key.tenantId} AND external_id = ${external_id} RETURNING id, name, customer_id`;
            if (b) await refreshCounters(tx, new Set(), new Set([b.customer_id]), new Set());
            if (b) await audit(tx, key, 'api.branches.delete', { external_id });
            if (b) await emitEvents(tx, key.tenantId, [{ event: 'branch.deleted', data: { id: b.id, external_id, name: b.name, customer_id: b.customer_id } }], src(key));
            return !!b;
          }
          const [s] = await tx`DELETE FROM spaces s USING branches b WHERE s.tenant_id = ${key.tenantId} AND s.external_id = ${external_id} AND b.id = s.branch_id
                               RETURNING s.id, s.name, s.branch_id, b.customer_id`;
          if (s) await refreshCounters(tx, new Set([s.branch_id]), new Set([s.customer_id]), new Set());
          if (s) await audit(tx, key, 'api.spaces.delete', { external_id });
          if (s) await emitEvents(tx, key.tenantId, [{ event: 'space.deleted', data: { id: s.id, external_id, name: s.name, branch_id: s.branch_id } }], src(key));
          return !!s;
        });
        return ok ? { ok: true } : problem(reply, 404, 'not_found');
      });
    }

    // ----- value lists (pick-lists of the forms): read & write by name
    const LIST_INFO: Record<string, string> = {
      geo_zone: 'Geographic zone (customers, stores)', fee_schedule: 'Fee schedule (stores)', tour: 'Field tour (stores)',
      ongoing_status: 'Status on going (stores)', prefecture: 'Prefecture (customers address.region, stores region)',
      customer_category: 'Customer category', customer_source: 'Customer source', payment_terms: 'Payment terms (customers)', space_kind: 'Space kind',
    };
    const listParam = z.object({ list: z.enum(ALL_LISTS) });

    r.get('/v1/lists', async (req, reply) => {
      if (!need(req, reply, 'lists', 'read')) return;
      const T = req.apiKey!.tenantId;
      const counts = await withTenant(T, (tx) => tx`
        SELECT list, count(*)::int AS values, count(*) FILTER (WHERE active)::int AS active FROM lookup_values WHERE tenant_id = ${T} GROUP BY list`);
      return {
        items: ALL_LISTS.map((l) => {
          const c = counts.find((x) => x.list === l);
          return { list: l, description: LIST_INFO[l], stored_as: isNameList(l) ? 'name' : 'reference', values: c?.values ?? 0, active: c?.active ?? 0 };
        }),
      };
    });

    r.get('/v1/lists/:list', async (req, reply) => {
      if (!need(req, reply, 'lists', 'read')) return;
      const { list } = listParam.parse(req.params);
      const { include_inactive } = z.object({ include_inactive: z.enum(['0', '1']).default('1') }).parse(req.query);
      const T = req.apiKey!.tenantId;
      const values = await withTenant(T, (tx) => tx`
        SELECT name, active, sort, created_at FROM lookup_values
        WHERE tenant_id = ${T} AND list = ${list} ${include_inactive === '0' ? tx`AND active` : tx``} ORDER BY sort, name`);
      return { list, description: LIST_INFO[list], values };
    });

    // Upsert values by name (accent/case-insensitive). rename_from renames an existing value; records using it follow.
    const valueIn = z.object({
      name: z.string().trim().min(1).max(80),
      rename_from: z.string().trim().min(1).max(80).optional(),
      active: z.boolean().optional(),
      sort: z.number().int().min(0).max(100000).optional(),
    }).strict();
    r.put('/v1/lists/:list/values', async (req, reply) => {
      if (!need(req, reply, 'lists', 'write')) return;
      const { list } = listParam.parse(req.params);
      const { values } = z.object({ values: z.array(z.unknown()).min(1).max(500) }).parse(req.body);
      const key = req.apiKey!;
      const T = key.tenantId;
      const results = await withTenant(T, async (tx) => {
        const out = await runBatch(tx, values, valueIn, async (v, sp) => {
          const findBy = v.rename_from ?? v.name;
          const [found] = await sp`SELECT id, name, active, sort FROM lookup_values WHERE tenant_id = ${T} AND list = ${list} AND search_key(name) = search_key(${findBy})`;
          if (v.rename_from && !found) throw new RowError('not_found', v.rename_from);
          if (found) {
            if (v.rename_from && found.name !== v.name) {
              const [dup] = await sp`SELECT 1 FROM lookup_values WHERE tenant_id = ${T} AND list = ${list} AND id <> ${found.id} AND search_key(name) = search_key(${v.name})`;
              if (dup) throw new RowError('duplicate', v.name);
              if (isNameList(list)) await renameInRecords(sp, T, list, found.name, v.name);
            }
            await sp`UPDATE lookup_values SET name = ${v.rename_from ? v.name : found.name}, active = ${v.active ?? found.active}, sort = ${v.sort ?? found.sort} WHERE id = ${found.id}`;
            return { status: 'updated', id: found.id };
          }
          const [{ next }] = await sp`SELECT coalesce(max(sort), 0) + 1 AS next FROM lookup_values WHERE tenant_id = ${T} AND list = ${list}`;
          const [row] = await sp`INSERT INTO lookup_values (tenant_id, list, name, active, sort) VALUES (${T}, ${list}, ${v.name}, ${v.active ?? true}, ${v.sort ?? next}) RETURNING id`;
          return { status: 'created', id: row.id };
        }, (raw) => (raw as { name?: string })?.name ?? '');
        const sum = summary(out);
        await audit(tx, key, 'api.lists.batch', { list, created: sum.created, updated: sum.updated, failed: sum.failed });
        return out;
      });
      req.apiLog = { ...req.apiLog, items: results.length, ...(({ created, updated, failed }) => ({ created, updated, failed }))(summary(results)) };
      return { list, ...summary(results).valueOf(), results: results.map(({ id: _id, external_id, ...x }) => ({ name: external_id, ...x })) };
    });

    // Delete a value that nothing uses (otherwise 409 in_use: deactivate it with active=false instead)
    r.delete('/v1/lists/:list/values/:name', async (req, reply) => {
      if (!need(req, reply, 'lists', 'write')) return;
      const { list, name } = z.object({ list: z.enum(ALL_LISTS), name: z.string().trim().min(1).max(80) }).parse(req.params);
      const key = req.apiKey!;
      const T = key.tenantId;
      const res = await withTenant(T, async (tx) => {
        const [v] = await tx`SELECT id, name FROM lookup_values WHERE tenant_id = ${T} AND list = ${list} AND search_key(name) = search_key(${name})`;
        if (!v) return 404;
        const used = isNameList(list) ? await nameInUse(tx, T, list, v.name) : (await tx`
          SELECT 1 WHERE EXISTS (SELECT 1 FROM branches WHERE geo_zone_id = ${v.id} OR fee_schedule_id = ${v.id} OR tour_id = ${v.id} OR ongoing_status_id = ${v.id})
                      OR EXISTS (SELECT 1 FROM customers WHERE geo_zone_id = ${v.id})`).length > 0;
        if (used) return 409;
        await tx`DELETE FROM lookup_values WHERE id = ${v.id}`;
        await audit(tx, key, 'api.lists.delete', { list, name: v.name });
        return 200;
      });
      return res === 200 ? { ok: true } : problem(reply, res, res === 404 ? 'not_found' : 'in_use');
    });
  });
}
