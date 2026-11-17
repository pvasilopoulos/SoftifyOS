// SoftifyOS load test: N simulated users browsing the app (read-only: safe on production).
//
//   LOADTEST_EMAIL=… LOADTEST_PASSWORD=… node scripts/loadtest.mjs --url https://app.softify.gr --users 50 --seconds 60
//
// Options: --url (default http://localhost:3000), --users (concurrent users, 20), --seconds (30), --think (ms between a
// user's requests, 300). Credentials come from environment variables so they never land in the shell history.
// Prints requests/second and p50/p95/p99 latency per endpoint; exits with 1 when the error rate is above 1% or p95 > 1 s.
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const BASE = arg('url', 'http://localhost:3000').replace(/\/$/, '');
const USERS = Number(arg('users', 20));
const SECONDS = Number(arg('seconds', 30));
const THINK = Number(arg('think', 300));
const email = process.env.LOADTEST_EMAIL, password = process.env.LOADTEST_PASSWORD;
if (!email || !password) { console.error('Set LOADTEST_EMAIL and LOADTEST_PASSWORD'); process.exit(2); }

// What a user does, with weights (how often)
const words = ['αθη', 'market', 'καφε', 'omega', 'retail', 'φαρμα', 'γιαν', 'πα', 'trading', 'κρητ'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const iso = (d) => d.toISOString();
const SCENARIO = [
  [10, 'dashboard', () => '/api/dashboard'],
  [20, 'customers list', () => '/api/customers?limit=30'],
  [20, 'customers search', () => `/api/customers?q=${encodeURIComponent(pick(words))}&limit=30`],
  [12, 'offers list', () => `/api/offers?limit=30${Math.random() < 0.5 ? `&status=${pick(['sent', 'approved', 'draft'])}` : ''}`],
  [8, 'customer detail', (ctx) => ctx.customers.length ? `/api/customers/${pick(ctx.customers)}` : '/api/customers?limit=30'],
  [8, 'offer detail', (ctx) => ctx.offers.length ? `/api/offers/${pick(ctx.offers)}` : '/api/offers?limit=30'],
  [8, 'crm activities', () => '/api/crm/activities?limit=30'],
  [6, 'calendar', () => { const s = new Date(); s.setHours(0, 0, 0, 0); return `/api/events?from=${iso(s)}&to=${iso(new Date(s.getTime() + 7 * 864e5))}&all=0`; }],
  [5, 'tasks', () => '/api/tasks?limit=30'],
  [3, 'documents', () => '/api/documents?limit=30'],
];
const total = SCENARIO.reduce((s, [w]) => s + w, 0);
const choose = () => { let r = Math.random() * total; for (const s of SCENARIO) { if ((r -= s[0]) < 0) return s; } return SCENARIO[0]; };

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login failed: HTTP ${r.status}`);
  const cookie = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]).map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
  return cookie;
}

const stats = new Map();   // name → { ms: number[], errors: number, codes: Map }
const rec = (name, ms, ok, code) => {
  const s = stats.get(name) ?? { ms: [], errors: 0, codes: new Map() };
  s.ms.push(ms); if (!ok) { s.errors++; s.codes.set(code, (s.codes.get(code) ?? 0) + 1); }
  stats.set(name, s);
};
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

console.log(`SoftifyOS load test → ${BASE} · ${USERS} users · ${SECONDS}s · think ${THINK}ms`);
const cookie = await login();
const ctx = { customers: [], offers: [] };
const seed = async (path, key) => {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
  if (r.ok) { const j = await r.json(); ctx[key] = (j.items ?? j).slice(0, 30).map((x) => x.id); }
};
await seed('/api/customers?limit=30', 'customers');
await seed('/api/offers?limit=30', 'offers');

const end = Date.now() + SECONDS * 1000;
let done = 0;
const ticker = setInterval(() => process.stdout.write(`\r  ${done} requests…`), 1000);
await Promise.all(Array.from({ length: USERS }, async (_, u) => {
  await new Promise((r) => setTimeout(r, (u * 1000) / USERS));   // ramp up over the first second
  while (Date.now() < end) {
    const [, name, path] = choose();
    const t0 = performance.now();
    let ok = false, code = 0;
    try {
      const r = await fetch(`${BASE}${path(ctx)}`, { headers: { cookie }, signal: AbortSignal.timeout(15000) });
      await r.arrayBuffer();
      code = r.status; ok = r.ok;
    } catch (e) { code = e.name === 'TimeoutError' ? 'timeout' : 'network'; }
    rec(name, performance.now() - t0, ok, code);
    done++;
    await new Promise((r) => setTimeout(r, THINK * (0.5 + Math.random())));
  }
}));
clearInterval(ticker);

const all = [...stats.values()].flatMap((s) => s.ms);
const errors = [...stats.values()].reduce((n, s) => n + s.errors, 0);
const pad = (x, n) => String(x).padStart(n);
console.log(`\r\n${'endpoint'.padEnd(18)} ${pad('reqs', 6)} ${pad('p50', 7)} ${pad('p95', 7)} ${pad('p99', 7)} ${pad('errors', 7)}`);
for (const [name, s] of [...stats.entries()].sort((a, b) => b[1].ms.length - a[1].ms.length)) {
  const codes = [...s.codes.entries()].map(([c, n]) => `${c}×${n}`).join(' ');
  console.log(`${name.padEnd(18)} ${pad(s.ms.length, 6)} ${pad(Math.round(pct(s.ms, 50)), 5)}ms ${pad(Math.round(pct(s.ms, 95)), 5)}ms ${pad(Math.round(pct(s.ms, 99)), 5)}ms ${pad(s.errors, 7)} ${codes}`);
}
const rps = all.length / SECONDS, p95 = pct(all, 95), errRate = all.length ? errors / all.length : 1;
console.log(`\nTotal ${all.length} requests · ${rps.toFixed(1)} req/s · p50 ${Math.round(pct(all, 50))}ms · p95 ${Math.round(p95)}ms · p99 ${Math.round(pct(all, 99))}ms · errors ${(errRate * 100).toFixed(2)}%`);
const pass = errRate <= 0.01 && p95 <= 1000;
console.log(pass ? '✓ PASS (errors ≤ 1%, p95 ≤ 1 s)' : '✗ FAIL (errors > 1% or p95 > 1 s)');
process.exit(pass ? 0 : 1);
