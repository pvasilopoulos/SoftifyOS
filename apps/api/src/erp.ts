// Two-way sync of CRM activities with SoftOne Soft1 (Settings → ERP).
//
//   pull: Soft1 browser of the activities object (changed since the last run) → getData per record →
//         mapped to an activity → inserted / updated here (when the Soft1 values changed since the last sync).
//   push: activities changed here (erp_state = 'pending', set by a trigger) → setData; deletions → delData.
//   Conflicts (changed on both sides between two syncs) follow erp_meta.conflict: newest | erp | softify.
//   Changes written by the sync run with app.erp_sync = '1', so they are not sent back (no echo).
import { createHash } from 'node:crypto';
import { sql, type Tx } from './db.js';
import { insertActivity, type Row } from './crm.js';
import { decryptSecret } from './registries.js';
import { Soft1, Soft1Error, type Soft1Config } from './softone.js';

export type ErpFields = {
  code: string; series: string; date: string; start: string; end: string; customer: string; branch: string;
  requester: string; owner: string; subject: string; remarks: string; characterization: string; status: string;
  priority: string; updated: string;
};
export type ErpListSource = { object: string; code: string; name: string; active: string };
export type ErpMeta = {
  provider: 'softone'; enabled: boolean; direction: 'both' | 'pull' | 'push'; conflict: 'newest' | 'erp' | 'softify';
  interval_min: number; window_days: number;
  object: string; table: string; list: string; filter: string; reconcile_filter: string;
  fields: ErpFields; customer_match: 'external_id' | 'code';
  series_map: Record<string, string>; default_series: string; default_type: string;
  users_map: Record<string, string>; priority_map: Record<string, number>;
  lists: { characterization: ErpListSource; status: ErpListSource };
  /** Values met in Soft1 records, "code" → "name" (to map series, users, priorities by name) */
  seen?: Partial<Record<'series' | 'users' | 'priority' | 'characterization' | 'status', Record<string, string>>>;
  // last run (written by the sync)
  last_pull_at?: string | null; last_push_at?: string | null; last_reconcile_at?: string | null;
  last_ok_at?: string | null; last_error?: string | null; connected?: { company: string; at: string } | null;
  running?: { what: string; since: string } | null;
};

/** Field names of SOACTION in Soft1 (checked on a real installation). Lookups come as "code|name". */
export const SOFT1_FIELDS = {
  code: 'SOACTIONCODE', series: 'SERIES', date: 'TRNDATE', start: 'FROMDATE', end: 'FINALDATE', customer: 'TRDR', branch: 'TRDBRANCH',
  requester: 'ORDEREDBY', owner: 'ACTOR', subject: 'COMMENTS', remarks: 'REMARKS', characterization: 'ACTSTATES', status: 'ACTSTATUS',
  priority: 'PRIORITY', updated: 'UPDDATE',
};
/** Field names usual in Soft1 for CRM activities; confirm them in Settings → ERP (field discovery). */
export const DEFAULT_META: ErpMeta = {
  provider: 'softone', enabled: false, direction: 'both', conflict: 'newest', interval_min: 2, window_days: 365,
  object: 'SOACTION', table: 'SOACTION', list: '', filter: 'SOACTION.UPDDATE={since}', reconcile_filter: 'SOACTION.TRNDATE={from}&SOACTION.TRNDATE_TO={to}',
  fields: SOFT1_FIELDS,
  customer_match: 'external_id', series_map: {}, default_series: '', default_type: 'meeting',
  users_map: {}, priority_map: { 1: 1, 2: 2, 3: 3 },
  lists: { characterization: { object: '', code: 'CODE', name: 'NAME', active: 'ISACTIVE' }, status: { object: '', code: 'CODE', name: 'NAME', active: 'ISACTIVE' } },
};

export function withDefaults(m: Partial<ErpMeta> | null | undefined): ErpMeta {
  const x = (m ?? {}) as Partial<ErpMeta>;
  return {
    ...DEFAULT_META, ...x, fields: { ...DEFAULT_META.fields, ...(x.fields ?? {}) },
    lists: {
      characterization: { ...DEFAULT_META.lists.characterization, ...(x.lists?.characterization ?? {}) },
      status: { ...DEFAULT_META.lists.status, ...(x.lists?.status ?? {}) },
    },
    series_map: x.series_map ?? {}, users_map: x.users_map ?? {}, priority_map: x.priority_map ?? DEFAULT_META.priority_map,
  };
}

/** The values seen in the screenshots of Soft1 (Χαρακτηρισμός ενεργειών / Κατάσταση): a starting point to edit. */
export const PRESET_VALUES = {
  characterization: [
    ['101', 'Ενημέρωση πελάτη', true, null], ['102', 'Follow up', true, null], ['103', 'Χωρίς ενημέρωση', true, null],
    ['104', 'Χωρίς απόκριση', true, null], ['105', 'Πληρωμή Στο Τέλος Του Χρόνου', false, null], ['106', 'Follow up (Ολοκληρώθηκε)', true, 'done'],
    ['120', 'Ακύρωση', true, 'cancelled'], ['121', 'Προς εκτέλεση', true, 'planned'], ['122', 'Εκτελεσμένη', true, 'done'],
    ['123', 'Σε αναστολή', false, null], ['124', 'Προς έναρξη', true, 'planned'], ['200', 'Ακύρωση', true, 'cancelled'],
    ['201', 'Προς εκτέλεση', true, 'planned'], ['202', 'Εκτελεσμένη', true, 'done'], ['203', 'Σε εξέλιξη', true, 'in_progress'],
    ['801', 'Απαντημένο', true, null], ['802', 'Αναπάντητο', true, null], ['803', 'Δεν παραδόθηκε', true, null],
    ['804', 'Παραδόθηκε', true, null], ['805', 'Προβλήθηκε', true, null], ['806', 'Σε αναμονή', true, 'planned'], ['900', 'Εσωτερική Σημείωση', true, null],
  ] as [string, string, boolean, string | null][],
  // Codes are provisional until the list is read from Soft1 (Settings → ERP → read lists)
  status: [
    ['1', 'Προς έναρξη', true, 'planned'], ['2', 'Σε εξέλιξη', true, 'in_progress'], ['3', 'Ολοκληρώθηκε', true, 'done'],
    ['4', 'Ακυρώθηκε', true, 'cancelled'], ['5', 'Αδιάφορο', true, 'cancelled'], ['6', 'Σε αναμονή', true, 'planned'],
    ['7', 'Σε αναβολή', true, 'planned'], ['8', 'Προς επιστροφή', true, 'planned'],
  ] as [string, string, boolean, string][],
};

// ---------------------------------------------------------------- configuration
type Loaded = { meta: ErpMeta; conn: Soft1Config | null; tz: string };
export async function loadErp(T: string): Promise<Loaded> {
  const [t] = await sql`SELECT erp_enc, erp_meta, timezone FROM tenants WHERE id = ${T}`;
  const raw = decryptSecret((t?.erp_enc as string | null) ?? null);
  return { meta: withDefaults(t?.erp_meta as Partial<ErpMeta>), conn: raw ? (JSON.parse(raw) as Soft1Config) : null, tz: (t?.timezone as string) || 'Europe/Athens' };
}
async function saveRun(T: string, patch: Partial<ErpMeta>) {
  await sql`UPDATE tenants SET erp_meta = coalesce(erp_meta, '{}'::jsonb) || ${sql.json(patch as never)} WHERE id = ${T}`;
}
export async function erpLog(T: string, level: 'info' | 'warning' | 'error', action: string, message: string, ids: { activity_id?: string | null; external_id?: string | null } = {}) {
  await sql`INSERT INTO erp_sync_log (tenant_id, level, action, activity_id, external_id, message)
            VALUES (${T}, ${level}, ${action}, ${ids.activity_id ?? null}, ${ids.external_id ?? null}, ${message.slice(0, 2000)})`;
}
const client = (l: Loaded) => {
  if (!l.conn) throw new Soft1Error('Δεν έχουν οριστεί στοιχεία σύνδεσης Soft1');
  return new Soft1(l.conn);
};

// ---------------------------------------------------------------- dates (Soft1 keeps local time, no zone)
function offsetMin(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(d.getTime() / 1000) * 1000) / 60_000;
}
export function fromErpDate(v: unknown, tz: string): Date | null {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return new Date(guess - offsetMin(new Date(guess), tz) * 60_000);
}
export function toErpDate(d: Date | null | undefined, tz: string): string | null {
  if (!d) return null;
  const local = new Date(d.getTime() + offsetMin(d, tz) * 60_000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- mapping
const MAPPED: (keyof ErpFields)[] = ['code', 'series', 'date', 'start', 'end', 'customer', 'branch', 'requester', 'owner', 'subject', 'remarks', 'characterization', 'status', 'priority'];
/** Fingerprint of the Soft1 values we use: changes on the Soft1 side are detected by comparing it. */
export function remoteHash(meta: ErpMeta, rec: Row) {
  const vals = MAPPED.map((k) => (meta.fields[k] ? rec[meta.fields[k]] ?? null : null)).map((v) => (v === null || v === undefined ? null : String(v)));
  return createHash('sha1').update(JSON.stringify(vals)).digest('hex');
}
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
/** Soft1 lookups: "495|Πουλημένου Μαρία" → code 495, name … (plain values: code only). */
export function part(v: unknown): { code: string | null; name: string | null } {
  const x = str(v);
  if (!x) return { code: null, name: null };
  const i = x.indexOf('|');
  return i < 0 ? { code: x, name: null } : { code: x.slice(0, i) || null, name: x.slice(i + 1) || null };
}
type Seen = NonNullable<ErpMeta['seen']>;

export type Mapped = {
  erp_code: string | null; type: string; due_at: Date | null; ends_at: Date | null; customer_id: string | null; customer_label: string | null;
  branch_id: string | null; requested_by: string | null; owner_id: string | null; subject: string; body: string | null;
  characterization: string | null; erp_status: string | null; priority: number; remote_updated: Date | null; problems: string[];
  seen: Seen;
};

/** Soft1 record → activity values (looks up customer, store, people, lists). */
export async function fromErp(tx: Tx | typeof sql, T: string, l: Loaded, rec: Row, opts: { learn?: boolean } = {}): Promise<Mapped> {
  const f = l.meta.fields, raw = (k: keyof ErpFields) => (f[k] ? rec[f[k]] : undefined), get = (k: keyof ErpFields) => part(raw(k)).code;
  const problems: string[] = [];
  const seen: Seen = {};
  const note = (kind: keyof Seen, k: keyof ErpFields) => { const x = part(raw(k)); if (x.code) (seen[kind] ??= {})[x.code] = x.name ?? x.code; };
  note('series', 'series'); note('users', 'owner'); note('users', 'requester'); note('priority', 'priority'); note('characterization', 'characterization'); note('status', 'status');
  let customer_id: string | null = null;
  // By code: Soft1 sends the customer's code next to its id (TRDR_GENTRDR_CODE); by id: the internal TRDR
  const custVal = l.meta.customer_match === 'code' && f.customer ? str(rec[`${f.customer}_GENTRDR_CODE`]) ?? get('customer') : get('customer');
  if (custVal) {
    const [c] = l.meta.customer_match === 'code'
      ? await tx`SELECT id FROM customers WHERE tenant_id = ${T} AND code = ${custVal}`
      : await tx`SELECT id FROM customers WHERE tenant_id = ${T} AND external_id = ${custVal}`;
    customer_id = (c?.id as string) ?? null;
    if (!customer_id) problems.push(`customer_not_found:${custVal}`);
  }
  let branch_id: string | null = null;
  const brVal = str(get('branch'));
  if (brVal && customer_id) {
    const [b] = await tx`SELECT id FROM branches WHERE tenant_id = ${T} AND customer_id = ${customer_id} AND external_id = ${brVal}`;
    branch_id = (b?.id as string) ?? null;
  }
  const user = (v: unknown) => { const k = str(v); return k ? l.meta.users_map[k] ?? null : null; };
  const series = str(get('series'));
  const type = (series && l.meta.series_map[series]) || l.meta.default_type;
  const listCode = async (kind: 'characterization' | 'status', field: keyof ErpFields) => {
    const { code: k, name } = part(raw(field));
    if (!k) return null;
    const [x] = await tx`SELECT code FROM crm_erp_values WHERE tenant_id = ${T} AND kind = ${kind} AND code = ${k}`;
    if (x) return k;
    // A value the list does not have yet: learnt from Soft1 with its name (the status mapping stays to be set)
    if (name) {
      if (opts.learn) await tx`INSERT INTO crm_erp_values (tenant_id, kind, code, name, active, sort) VALUES (${T}, ${kind}, ${k}, ${name.slice(0, 100)}, true, ${Number(k) || 100}) ON CONFLICT DO NOTHING`;
      return k;
    }
    problems.push(`${kind}_unknown:${k}`);
    return null;
  };
  const start = fromErpDate(raw('start'), l.tz) ?? fromErpDate(raw('date'), l.tz);
  const prio = str(get('priority'));
  return {
    erp_code: str(raw('code')), type,
    due_at: start, ends_at: fromErpDate(raw('end'), l.tz),
    customer_id, customer_label: custVal, branch_id,
    requested_by: user(get('requester')), owner_id: user(get('owner')),
    subject: (str(raw('subject')) ?? str(raw('code')) ?? '—').slice(0, 200),
    body: str(raw('remarks'))?.slice(0, 20000) ?? null,
    characterization: await listCode('characterization', 'characterization'),
    erp_status: await listCode('status', 'status'),
    priority: prio && l.meta.priority_map[prio] ? Math.min(3, Math.max(1, l.meta.priority_map[prio])) : 2,
    remote_updated: fromErpDate(raw('updated'), l.tz), problems, seen,
  };
}

/** Activity → Soft1 fields (only the mapped ones). Throws when something required cannot be expressed. */
async function toErp(T: string, l: Loaded, a: Row, isNew: boolean): Promise<Row> {
  const f = l.meta.fields, out: Row = {};
  const put = (k: keyof ErpFields, v: unknown) => { if (f[k]) out[f[k]] = v; };
  if (a.customer_id) {
    const [c] = await sql`SELECT code, external_id FROM customers WHERE id = ${a.customer_id as string}`;
    const v = l.meta.customer_match === 'code' ? c?.code : c?.external_id;
    if (!v) throw new Soft1Error('Ο πελάτης δεν έχει κωδικό Soft1 (external id)');
    put('customer', v);
  } else throw new Soft1Error('Η ενέργεια δεν έχει πελάτη');
  if (a.branch_id) {
    const [b] = await sql`SELECT external_id FROM branches WHERE id = ${a.branch_id as string}`;
    if (b?.external_id) put('branch', b.external_id);
  }
  if (isNew) {
    const series = Object.entries(l.meta.series_map).find(([, t]) => t === a.type)?.[0] || l.meta.default_series;
    if (f.series && !series) throw new Soft1Error(`Δεν έχει οριστεί σειρά Soft1 για το είδος «${String(a.type)}»`);
    if (series) put('series', series);
  }
  const userOf = (id: unknown) => (id ? Object.entries(l.meta.users_map).find(([, u]) => u === id)?.[0] ?? null : null);
  if (f.owner) { const v = userOf(a.owner_id); if (v) put('owner', v); }
  if (f.requester) { const v = userOf(a.requested_by); if (v) put('requester', v); }
  const due = a.due_at as Date | null;
  if (due) { put('date', `${toErpDate(due, l.tz)!.slice(0, 10)} 00:00:00`); put('start', toErpDate(due, l.tz)); }
  put('end', toErpDate(a.ends_at as Date | null, l.tz));
  put('subject', a.subject);
  put('remarks', a.body ?? '');
  put('characterization', a.characterization ?? null);
  put('status', a.erp_status ?? null);
  if (f.priority) {
    const v = Object.entries(l.meta.priority_map).find(([, p]) => p === a.priority)?.[0];
    if (v) put('priority', v);
  }
  return out;
}

/** Writes Soft1 values onto a new or existing activity (as the sync: not sent back). */
async function applyRemote(T: string, l: Loaded, key: string, rec: Row, m: Mapped, localId: string | null) {
  const hash = remoteHash(l.meta, rec);
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.erp_sync', '1', true)`;
    const vals = {
      type: m.type, subject: m.subject, body: m.body, priority: m.priority, due_at: m.due_at, ends_at: m.ends_at,
      duration_min: m.due_at && m.ends_at ? Math.max(0, Math.min(10080, Math.round((m.ends_at.getTime() - m.due_at.getTime()) / 60_000))) : 0,
      customer_id: m.customer_id, branch_id: m.branch_id, characterization: m.characterization, erp_status: m.erp_status, erp_code: m.erp_code,
    };
    let id = localId;
    if (!id) {
      [id] = await insertActivity(tx as unknown as Tx, T, null, { ...vals, external_id: key, owner_id: m.owner_id, requested_by: m.requested_by });
    } else {
      // People are only overwritten when Soft1 names someone we know (unmapped users keep the local choice)
      await tx`UPDATE crm_activities SET ${tx(vals as never)},
                 owner_id = coalesce(${m.owner_id}::uuid, owner_id), requested_by = coalesce(${m.requested_by}::uuid, requested_by), updated_at = now()
               WHERE id = ${id}`;
    }
    await tx`UPDATE crm_activities SET erp_state = 'synced', erp_error = NULL, erp_hash = ${hash}, erp_synced_at = now() WHERE id = ${id}`;
    return id!;
  });
}

export async function rememberSeen(T: string, add: Seen) {
  if (!Object.keys(add).length) return;
  const [t] = await sql`SELECT erp_meta->'seen' AS seen FROM tenants WHERE id = ${T}`;
  const cur = (t?.seen ?? {}) as Seen;
  for (const [k, v] of Object.entries(add) as [keyof Seen, Record<string, string>][]) {
    cur[k] = Object.fromEntries(Object.entries({ ...(cur[k] ?? {}), ...v }).slice(-300));
  }
  await saveRun(T, { seen: cur });
}
const mergeSeen = (a: Seen, b: Seen) => { for (const [k, v] of Object.entries(b) as [keyof Seen, Record<string, string>][]) a[k] = { ...(a[k] ?? {}), ...v }; return a; };

// ---------------------------------------------------------------- pull
export type PullResult = { seen: number; created: number; updated: number; unchanged: number; skipped: number; conflicts: number; deleted: number; preview?: (Mapped & { key: string; action: string })[] };

export async function pull(T: string, opts: { dryRun?: boolean; limit?: number; full?: boolean } = {}): Promise<PullResult> {
  const l = await loadErp(T);
  const s1 = client(l);
  const r: PullResult = { seen: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, deleted: 0, preview: opts.dryRun ? [] : undefined };
  const since = l.meta.last_pull_at && !opts.full && !opts.dryRun
    ? new Date(new Date(l.meta.last_pull_at).getTime() - 864e5)                  // one day of overlap: Soft1 filters by date
    : new Date(Date.now() - l.meta.window_days * 864e5);
  const filter = l.meta.filter.replaceAll('{since}', isoDay(since)).replaceAll('{from}', isoDay(since)).replaceAll('{to}', isoDay(new Date(Date.now() + 366 * 864e5)));
  const started = new Date();
  const rows = await s1.browse(l.meta.object, l.meta.list, filter, opts.limit ?? 2000);
  const seenAll: Seen = {};
  for (const { key } of opts.dryRun ? rows.slice(0, 25) : rows) {
    r.seen++;
    const rec = await s1.get(l.meta.object, l.meta.table, key);
    if (!rec) continue;
    const [local] = await sql`SELECT id, erp_hash, erp_state, updated_at FROM crm_activities WHERE tenant_id = ${T} AND external_id = ${key}`;
    const hash = remoteHash(l.meta, rec);
    if (local && local.erp_hash === hash) { r.unchanged++; continue; }
    const m = await fromErp(sql, T, l, rec, { learn: !opts.dryRun });
    mergeSeen(seenAll, m.seen);
    if (!m.customer_id) {
      r.skipped++;
      if (opts.dryRun) r.preview!.push({ ...m, key, action: 'skip' });
      // Once a day per record: the same skip would otherwise be logged on every run
      else if (!(await sql`SELECT 1 FROM erp_sync_log WHERE tenant_id = ${T} AND external_id = ${key} AND action = 'pull' AND at > now() - interval '1 day'`)[0]) {
        await erpLog(T, 'warning', 'pull', `Παράλειψη ${m.erp_code ?? key}: ο πελάτης ${m.customer_label ?? '—'} δεν βρέθηκε`, { external_id: key });
      }
      continue;
    }
    if (local?.erp_state === 'pending') {
      // Changed on both sides since the last sync
      const remoteWins = l.meta.conflict === 'erp' || (l.meta.conflict === 'newest' && !!m.remote_updated && m.remote_updated > (local.updated_at as Date));
      r.conflicts++;
      if (!opts.dryRun) await erpLog(T, 'warning', 'conflict', `${m.erp_code ?? key}: άλλαξε και στις δύο πλευρές — κρατήθηκε ${remoteWins ? 'η αλλαγή του Soft1' : 'η αλλαγή του SoftifyOS'}`, { activity_id: local.id as string, external_id: key });
      if (!remoteWins) continue;
    }
    if (opts.dryRun) { r.preview!.push({ ...m, key, action: local ? 'update' : 'create' }); if (r.preview!.length >= 25) break; continue; }
    await applyRemote(T, l, key, rec, m, (local?.id as string) ?? null);
    if (local) r.updated++; else r.created++;
    if (m.problems.length) await erpLog(T, 'warning', 'pull', `${m.erp_code ?? key}: ${m.problems.join(', ')}`, { external_id: key });
  }
  await rememberSeen(T, seenAll);
  if (opts.dryRun) return r;

  // Deleted in Soft1: compare the keys in the window (at most every 6 hours, with safety limits)
  const lastRec = l.meta.last_reconcile_at ? new Date(l.meta.last_reconcile_at).getTime() : 0;
  if (opts.full || Date.now() - lastRec > 6 * 3600e3) r.deleted = await reconcile(T, l, s1);
  await saveRun(T, { last_pull_at: started.toISOString(), last_ok_at: new Date().toISOString(), last_error: null });
  if (r.created || r.updated || r.deleted) {
    await erpLog(T, 'info', 'pull', `Από Soft1: ${r.created} νέες, ${r.updated} ενημερώσεις, ${r.deleted} διαγραφές`);
  }
  return r;
}

async function reconcile(T: string, l: Loaded, s1: Soft1) {
  const from = new Date(Date.now() - l.meta.window_days * 864e5), to = new Date(Date.now() + 366 * 864e5);
  const filter = l.meta.reconcile_filter.replaceAll('{from}', isoDay(from)).replaceAll('{to}', isoDay(to)).replaceAll('{since}', isoDay(from));
  const keys = new Set((await s1.browse(l.meta.object, l.meta.list, filter, 50_000)).map((x) => x.key));
  const local = await sql`SELECT id, external_id FROM crm_activities WHERE tenant_id = ${T} AND external_id IS NOT NULL AND erp_state = 'synced'
                          AND coalesce(due_at, created_at) >= ${from} AND coalesce(due_at, created_at) < ${to}`;
  const gone = local.filter((x) => !keys.has(x.external_id as string));
  // An empty or tiny answer usually means a wrong filter, not mass deletion: never delete in that case
  if (!keys.size || gone.length > Math.max(50, local.length * 0.2)) {
    if (gone.length) await erpLog(T, 'warning', 'delete', `Δεν έγιναν διαγραφές: λείπουν ${gone.length} από ${local.length} ενέργειες στο Soft1 (ελέγξτε το φίλτρο ελέγχου διαγραφών)`);
  } else if (gone.length) {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.erp_sync', '1', true)`;
      await tx`DELETE FROM crm_activities WHERE id = ANY(${gone.map((x) => x.id as string)}::uuid[])`;
    });
  }
  await saveRun(T, { last_reconcile_at: new Date().toISOString() });
  return keys.size ? gone.length : 0;
}

// ---------------------------------------------------------------- push
export type PushResult = { sent: number; created: number; deleted: number; failed: number; skipped: number; conflicts: number };

export async function push(T: string): Promise<PushResult> {
  const l = await loadErp(T);
  const s1 = client(l);
  const r: PushResult = { sent: 0, created: 0, deleted: 0, failed: 0, skipped: 0, conflicts: 0 };

  for (const d of await sql`SELECT external_id FROM erp_deletions WHERE tenant_id = ${T} AND entity = 'activity' LIMIT 200`) {
    try {
      await s1.remove(l.meta.object, d.external_id as string);
      r.deleted++;
    } catch (e) {
      // Already gone in Soft1 counts as done; anything else stays queued
      if (!/not\s*found|δεν\s*βρέθηκε|does not exist/i.test((e as Error).message)) {
        r.failed++;
        await erpLog(T, 'error', 'delete', `Διαγραφή ${String(d.external_id)} στο Soft1: ${(e as Error).message}`, { external_id: d.external_id as string });
        continue;
      }
    }
    await sql`DELETE FROM erp_deletions WHERE tenant_id = ${T} AND entity = 'activity' AND external_id = ${d.external_id as string}`;
  }

  const rows = await sql`SELECT * FROM crm_activities WHERE tenant_id = ${T} AND erp_state = 'pending' ORDER BY updated_at LIMIT 200`;
  for (const a of rows) {
    const id = a.id as string, key = (a.external_id as string | null) ?? null;
    const mark = (state: string, err: string | null) => sql.begin(async (tx) => {
      await tx`SELECT set_config('app.erp_sync', '1', true)`;
      await tx`UPDATE crm_activities SET erp_state = ${state}, erp_error = ${err} WHERE id = ${id}`;
    });
    try {
      if (key) {
        const remote = await s1.get(l.meta.object, l.meta.table, key);
        if (remote && remoteHash(l.meta, remote) !== a.erp_hash) {
          const m = await fromErp(sql, T, l, remote);
          const remoteWins = l.meta.conflict === 'erp' || (l.meta.conflict === 'newest' && !!m.remote_updated && m.remote_updated > (a.updated_at as Date));
          r.conflicts++;
          await erpLog(T, 'warning', 'conflict', `${String(a.erp_code ?? key)}: άλλαξε και στις δύο πλευρές — κρατήθηκε ${remoteWins ? 'η αλλαγή του Soft1' : 'η αλλαγή του SoftifyOS'}`, { activity_id: id, external_id: key });
          if (remoteWins && m.customer_id) { await applyRemote(T, l, key, remote, m, id); continue; }
        }
      }
      const data = await toErp(T, l, a, !key);
      const newKey = await s1.set(l.meta.object, l.meta.table, key, data);
      const back = await s1.get(l.meta.object, l.meta.table, newKey);
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.erp_sync', '1', true)`;
        await tx`UPDATE crm_activities SET external_id = ${newKey}, erp_code = coalesce(${back ? str(back[l.meta.fields.code]) : null}, erp_code),
                   erp_state = 'synced', erp_error = NULL, erp_hash = ${back ? remoteHash(l.meta, back) : null}, erp_synced_at = now() WHERE id = ${id}`;
      });
      r.sent++;
      if (!key) r.created++;
    } catch (e) {
      const msg = (e as Error).message;
      const skip = /πελάτη|σειρά Soft1/.test(msg);
      if (skip) r.skipped++; else r.failed++;
      await mark(skip ? 'skipped' : 'error', msg.slice(0, 1000));
      await erpLog(T, skip ? 'warning' : 'error', 'push', `«${String(a.subject)}»: ${msg}`, { activity_id: id, external_id: key });
    }
  }
  await saveRun(T, { last_push_at: new Date().toISOString(), ...(r.failed ? {} : { last_ok_at: new Date().toISOString(), last_error: null }) });
  if (r.sent || r.deleted) await erpLog(T, 'info', 'push', `Προς Soft1: ${r.sent} ενέργειες (${r.created} νέες), ${r.deleted} διαγραφές`);
  return r;
}

// ---------------------------------------------------------------- value lists from Soft1
export async function pullLists(T: string) {
  const l = await loadErp(T);
  const s1 = client(l);
  const out: Record<string, number> = {};
  for (const kind of ['characterization', 'status'] as const) {
    const src = l.meta.lists[kind];
    if (!src.object) continue;
    const rows = await s1.browse(src.object, '', '', 5000);
    const vals = rows.map(({ key, row }) => ({
      code: String(row[src.code] ?? key), name: String(row[src.name] ?? key).slice(0, 100),
      active: src.active ? !['0', 'false', ''].includes(String(row[src.active] ?? '1').toLowerCase()) : true,
    })).filter((v) => v.code);
    await sql.begin(async (tx) => {
      for (const v of vals) {
        // Name/active come from Soft1; the status mapping and types stay as set here
        await tx`INSERT INTO crm_erp_values (tenant_id, kind, code, name, active, sort) VALUES (${T}, ${kind}, ${v.code}, ${v.name}, ${v.active}, ${Number(v.code) || 100})
                 ON CONFLICT (tenant_id, kind, code) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active`;
      }
      if (vals.length) await tx`UPDATE crm_erp_values SET active = false WHERE tenant_id = ${T} AND kind = ${kind} AND NOT (code = ANY(${vals.map((v) => v.code)}))`;
    });
    out[kind] = vals.length;
  }
  await erpLog(T, 'info', 'lists', `Λίστες από Soft1: ${Object.entries(out).map(([k, n]) => `${k} ${n}`).join(', ') || 'δεν έχουν οριστεί αντικείμενα λιστών'}`);
  return out;
}

/** Runs a sync job; errors are recorded on the organisation (shown in Settings → ERP) and logged. */
export async function runErpJob(T: string, what: 'pull' | 'push' | 'lists' | 'full') {
  // Visible in Settings → ERP while it runs (the job itself has already left the queue)
  await saveRun(T, { running: { what, since: new Date().toISOString() } });
  try {
    if (what === 'lists') return await pullLists(T);
    if (what === 'push') return await push(T);
    if (what === 'full') { await pullLists(T).catch(() => null); const p = await pull(T, { full: true }); await push(T); return p; }
    return await pull(T);
  } catch (e) {
    const msg = (e as Error).message;
    await saveRun(T, { last_error: msg.slice(0, 500), ...(what === 'pull' || what === 'full' ? { last_pull_at: new Date().toISOString() } : {}) });
    await erpLog(T, 'error', what, msg);
    if (!(e instanceof Soft1Error)) throw e;
    return null;
  } finally {
    await saveRun(T, { running: null });
  }
}

/** Organisations whose next automatic pull is due (worker, every minute). */
export async function enqueueDuePulls() {
  await sql`
    INSERT INTO jobs (kind, payload)
    SELECT 'erp_pull', jsonb_build_object('tenantId', t.id) FROM tenants t
    WHERE (t.erp_meta->>'enabled')::boolean AND coalesce(t.erp_meta->>'direction', 'both') IN ('both', 'pull') AND t.erp_enc IS NOT NULL
      AND coalesce((t.erp_meta->>'last_pull_at')::timestamptz, 'epoch') < now() - make_interval(mins => greatest(1, coalesce((t.erp_meta->>'interval_min')::int, 2)))
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'erp_pull' AND j.payload->>'tenantId' = t.id::text)`;
  await sql`DELETE FROM erp_sync_log WHERE at < now() - interval '30 days'`;
}
