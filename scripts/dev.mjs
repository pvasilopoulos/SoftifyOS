// SoftifyOS local development: one command for everything.
//   npm run dev        → database + migrations + API + worker + web (http://localhost:3000)
//   Ctrl+C             → stops all of them
import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isWin = process.platform === 'win32';
const color = { db: 36, api: 35, worker: 33, web: 32, dev: 34 };
const tag = (name) => `\x1b[${color[name] ?? 37}m${name.padEnd(6)}\x1b[0m│ `;
const say = (msg) => console.log(tag('dev') + msg);

// Ports from .env (fallbacks = defaults)
const env = {};
if (existsSync(resolve(root, '.env'))) {
  for (const l of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2];
  }
} else {
  say('Δεν υπάρχει .env — αντέγραψε το .env.example σε .env (δες README).');
  process.exit(1);
}
const dbPort = Number(env.DATABASE_URL?.match(/:(\d+)\//)?.[1] ?? 5434);
const apiPort = Number(env.API_PORT ?? 4000);
const webPort = 3000;

const isOpen = (port) => new Promise((ok) => {
  const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); ok(true); });
  s.on('error', () => ok(false));
  s.setTimeout(500, () => { s.destroy(); ok(false); });
});
const waitFor = async (port, seconds) => {
  for (let i = 0; i < seconds * 4; i++) { if (await isOpen(port)) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
};

const children = [];
function run(name, args) {
  // One command string (not an args array) with shell: avoids Node's DEP0190 warning; args are fixed literals
  const child = spawn(`npm ${args.join(' ')}`, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
  children.push(child);
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) if (line.trim() && !/^> |^$/.test(line)) console.log(tag(name) + line);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => { if (!stopping) say(`${name} σταμάτησε (κωδικός ${code}).`); });
  return child;
}

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  say('Τερματισμός…');
  for (const c of children) {
    try {
      // npm runs through a shell: kill the whole process tree
      if (isWin) execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-c.pid, 'SIGTERM');
    } catch { try { c.kill('SIGTERM'); } catch {} }
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

// 1) Database
if (await isOpen(dbPort)) say(`Βάση: τρέχει ήδη (θύρα ${dbPort}).`);
else {
  say('Εκκίνηση βάσης…');
  run('db', ['run', 'db:dev', '-w', '@softify/api']);
  if (!(await waitFor(dbPort, 60))) { say('Η βάση δεν ξεκίνησε.'); stopAll(); }
}

// 2) Migrations (fast no-op when up to date)
// After an unclean shutdown Postgres replays its log first ("the database system is starting up"): wait for it
let mig;
for (let i = 0; i < 60; i++) {
  mig = spawnSync('npm run db:migrate -w @softify/api --silent', { cwd: root, shell: true, encoding: 'utf8' });
  if (mig.status === 0 || !/57P03|starting up|CONNECT_TIMEOUT|ECONNREFUSED/.test(mig.stdout + mig.stderr)) break;
  if (i === 0) say('Η βάση κάνει ανάκτηση μετά από απότομο κλείσιμο — αναμονή…');
  await new Promise((r) => setTimeout(r, 2000));
}
if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); say('Οι migrations απέτυχαν.'); stopAll(); }
else say('Migrations: ενημερωμένες.');

// 3) API, worker, web
if (await isOpen(apiPort)) say(`API: τρέχει ήδη (θύρα ${apiPort}) — δεν ξαναξεκινά.`);
else run('api', ['run', 'dev', '-w', '@softify/api']);
run('worker', ['run', 'dev:worker', '-w', '@softify/api']);
if (await isOpen(webPort)) say(`Web: τρέχει ήδη (θύρα ${webPort}) — δεν ξαναξεκινά.`);
else run('web', ['run', 'dev', '-w', '@softify/web']);

if (await waitFor(webPort, 90) && await waitFor(apiPort, 30)) {
  say('\x1b[1;32m✓ Το SoftifyOS τρέχει: http://localhost:3000/el\x1b[0m   (Ctrl+C για τερματισμό)');
}
