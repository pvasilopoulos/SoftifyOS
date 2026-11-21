// End-to-end test environment, isolated from your data:
//  - a throw-away database (softifyos_test_<time>) on the same local PostgreSQL as DATABASE_URL, migrated from scratch
//  - one organisation, two users, one customer with a branch (external ids matching scripts/soft1-mock.mjs)
//  - the real API and worker as child processes, the Soft1 emulator, and a fake Anthropic API (no cost, counts calls)
// Everything is removed at the end. Refuses to run against a non-local database.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as netServer } from 'node:net';
import postgres from 'postgres';
import { hash } from '@node-rs/argon2';

export const API_DIR = resolve(import.meta.dirname, '../..');
const ROOT = resolve(API_DIR, '../..');
export const PASSWORD = 'e2e-password-123';
export const OWNER_EMAIL = 'owner@e2e.test';
export const OPS_EMAIL = 'ops@e2e.test';

const freePort = () => new Promise<number>((done, fail) => {
  const s = netServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }).on('error', fail);
});
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 60_000, every = 400): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for: ${what}${last ? ` (last error: ${(last as Error).message})` : ''}`);
}

// ------------------------------------------------------------------ fake Anthropic Messages API
export type FakeCall = { system: string; structured: boolean; body: Record<string, unknown> };
export class FakeAnthropic {
  calls: FakeCall[] = [];
  failNext: number | null = null;          // HTTP status for the next call
  nextAction = {
    situation: 'Ο πελάτης δεν έχει απαντήσει στην προσφορά εδώ και δύο εβδομάδες.',
    actions: [
      { type: 'call', subject: 'Τηλεφωνική επικοινωνία για την προσφορά', why: 'Η προσφορά λήγει σύντομα.', due_in_days: 2, priority: 1 },
      { type: 'not_a_type', subject: 'Επίσκεψη', why: 'Δοκιμή καθαρισμού τιμών.', due_in_days: 500, priority: 9 },
    ],
    watch_out: null as string | null,
  };
  private server!: Server;
  url = '';
  async start() {
    this.server = createServer(async (req, res) => {
      const body = JSON.parse(await read(req) || '{}') as Record<string, unknown>;
      const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '');
      const structured = !!(body.output_config as { format?: unknown } | undefined)?.format;
      this.calls.push({ system, structured, body });
      if (this.failNext) {
        const status = this.failNext; this.failNext = null;
        res.writeHead(status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fake failure' } }));
      }
      const text = structured ? JSON.stringify(this.nextAction) : '**Ιστορικό σχέσης**\nΔοκιμαστική σύνοψη.';
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_fake_${this.calls.length}` });
      res.end(JSON.stringify({
        id: `msg_fake_${this.calls.length}`, type: 'message', role: 'assistant', model: body.model ?? 'claude-opus-5-5',
        content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  stop() { return new Promise<void>((r) => this.server.close(() => r())); }
}
const read = (req: IncomingMessage) => new Promise<string>((done) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => done(s)); });

// ------------------------------------------------------------------ child processes
class Proc {
  out = '';
  constructor(public name: string, public p: ChildProcess) {
    p.stdout?.on('data', (d) => { this.out += d; });
    p.stderr?.on('data', (d) => { this.out += d; });
  }
  stop() { if (this.p.exitCode === null) this.p.kill(); }
}

export type Env = {
  api: string; mock: string; ai: FakeAnthropic; sql: postgres.Sql; tenantId: string; ownerId: string; otherId: string;
  customerId: string; branchId: string; worker: Proc; apiProc: Proc; mockProc: Proc; backupDir: string;
  restartMock: () => Promise<void>; stopMock: () => void; stop: () => Promise<void>;
};

export async function startEnv(): Promise<Env> {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL (or TEST_DATABASE_URL) is needed: the tests create a temporary database on that server');
  const u = new URL(base);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) && process.env.TEST_ALLOW_REMOTE_DB !== '1') {
    throw new Error(`refusing to create test databases on ${u.hostname} (set TEST_ALLOW_REMOTE_DB=1 to allow)`);
  }
  const dbName = `softifyos_test_${Date.now()}`;
  const admin = postgres({ ...pgOpts(u), database: 'postgres' }, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const testUrl = new URL(base); testUrl.pathname = `/${dbName}`;
  const url = testUrl.toString();

  const node = (name: string, args: string[], env: Record<string, string>) =>
    new Proc(name, spawn(process.execPath, args, { cwd: API_DIR, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }));
  const migrate = node('migrate', ['--import', 'tsx', 'scripts/migrate.ts'], { DATABASE_URL: url });
  const code = await new Promise<number>((r) => migrate.p.on('close', (c) => r(c ?? 1)));
  if (code !== 0) throw new Error(`migrations failed:\n${migrate.out}`);

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const [t] = await sql`INSERT INTO tenants (slug, name) VALUES ('e2e', 'E2E Οργανισμός') RETURNING id`;
  const tenantId = t.id as string;
  await sql`SELECT provision_tenant(${tenantId})`;
  await sql`SELECT seed_default_lookups(${tenantId})`;
  await sql`INSERT INTO companies (tenant_id, name) VALUES (${tenantId}, 'E2E Α.Ε.')`;
  const pw = await hash(PASSWORD);
  const [owner] = await sql`INSERT INTO users (email, password_hash, full_name) VALUES (${OWNER_EMAIL}, ${pw}, 'Demo Χρήστης') RETURNING id`;
  const [other] = await sql`INSERT INTO users (email, password_hash, full_name) VALUES ('sales@e2e.test', ${pw}, 'Μαρία Κωνσταντίνου') RETURNING id`;
  await sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${owner.id}, 'owner'), (${tenantId}, ${other.id}, 'sales')`;
  const [cust] = await sql`INSERT INTO customers (tenant_id, code, name, external_id, account_manager_id, address_city)
                           VALUES (${tenantId}, 'CUST-E2E-1', 'Καφενείο Διδυμότειχο', '1001', ${owner.id}, 'Διδυμότειχο') RETURNING id`;
  const [br] = await sql`INSERT INTO branches (tenant_id, customer_id, name, external_id) VALUES (${tenantId}, ${cust.id}, 'Κεντρικό κατάστημα', '9999') RETURNING id`;

  const ai = new FakeAnthropic(); await ai.start();
  const [apiPort, mockPort] = [await freePort(), await freePort()];
  const backupDir = mkdtempSync(join(tmpdir(), 'softify-e2e-backup-'));
  writeFileSync(join(backupDir, 'last.json'), JSON.stringify({ finished_at: new Date().toISOString(), ok: true }));
  const uploadDir = mkdtempSync(join(tmpdir(), 'softify-e2e-files-'));
  const env = {
    DATABASE_URL: url, API_PORT: String(apiPort), API_HOST: '127.0.0.1', NODE_ENV: 'test', JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
    ANTHROPIC_API_KEY: 'sk-ant-e2e-fake', ANTHROPIC_BASE_URL: ai.url, ANTHROPIC_AUTH_TOKEN: '',
    SMTP_HOST: '', ALERT_EMAIL: OPS_EMAIL, ALERT_WEBHOOK_URL: '', PLATFORM_ADMINS: '', BACKUP_DIR: backupDir, UPLOAD_DIR: uploadDir,
    VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', STRIPE_SECRET_KEY: '', BILLING_ENFORCE: 'false', APP_URL: 'http://localhost:3999',
  };
  // This process imports src/ modules too (alerts, risk): same settings
  Object.assign(process.env, env);

  let mockProc = new Proc('soft1', spawn(process.execPath, [join(ROOT, 'scripts/soft1-mock.mjs'), String(mockPort)], { stdio: ['ignore', 'pipe', 'pipe'] }));
  const mock = `http://127.0.0.1:${mockPort}`;
  const apiProc = node('api', ['--import', 'tsx', 'src/server.ts'], env);
  const worker = node('worker', ['--import', 'tsx', 'src/worker.ts'], env);
  const api = `http://127.0.0.1:${apiPort}/api`;
  await waitFor('API up', async () => [200, 503].includes((await fetch(`${api}/health`)).status), 90_000).catch((e) => { throw new Error(`${e.message}\n${apiProc.out}`); });
  await waitFor('Soft1 emulator up', async () => (await fetch(`${mock}/__state`)).ok);
  await waitFor('worker up', async () => /worker started/.test(worker.out));

  return {
    api, mock, ai, sql, tenantId, ownerId: owner.id, otherId: other.id, customerId: cust.id, branchId: br.id, worker, apiProc, mockProc, backupDir,
    stopMock: () => mockProc.stop(),
    restartMock: async () => {
      mockProc.stop();
      mockProc = new Proc('soft1', spawn(process.execPath, [join(ROOT, 'scripts/soft1-mock.mjs'), String(mockPort)], { stdio: ['ignore', 'pipe', 'pipe'] }));
      await waitFor('Soft1 emulator up', async () => (await fetch(`${mock}/__state`)).ok);
    },
    stop: async () => {
      apiProc.stop(); worker.stop(); mockProc.stop();
      await ai.stop();
      await sql.end({ timeout: 5 });
      await sleep(500);
      if (!process.env.TEST_KEEP_DB) await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
      rmSync(backupDir, { recursive: true, force: true }); rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

function pgOpts(u: URL) {
  return { host: u.hostname, port: Number(u.port || 5432), username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

// ------------------------------------------------------------------ API client with a session cookie
export class Client {
  cookie = '';
  constructor(private base: string) {}
  async call<T = any>(method: string, path: string, json?: unknown): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(this.base + path, {
      method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : method !== 'GET' ? '{}' : undefined,
    });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let body: unknown = text; try { body = JSON.parse(text); } catch { /* text */ }
    return { status: r.status, body: body as T };
  }
  /** Same, but throws on HTTP errors (most steps). */
  async ok<T = any>(method: string, path: string, json?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await this.call<T>(method, path, json);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    return r.body;
  }
}
