// SoftifyOS on the Plesk Node.js extension (no root). Run from "Run Node.js commands":
//   npm run plesk -- init --db "postgresql://…"   create .env (secrets, ports) once
//   npm run plesk -- deploy                       install, build, migrate, restart (in the background; log: .run/deploy.log)
//   npm run plesk -- admin --slug … --name … --email … --full-name …   first organisation (password from admin-password.txt)
//   npm run plesk -- status | ensure | restart | stop | migrate
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const lib = createRequire(import.meta.url)('./lib.cjs');
const { root, envFile, runDir } = lib;
const [cmd = 'status', ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    args[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
}
const say = (m) => console.log(m);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };
// npm/node next to the running node binary (cron and Passenger may have a short PATH)
const PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`;

function run(command, cmdArgs, extraEnv = {}) {
  say(`\n==> ${command} ${cmdArgs.join(' ')}`);
  const r = spawnSync(command, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, PATH, ...extraEnv }, shell: process.platform === 'win32' });
  if (r.status !== 0) die(`απέτυχε: ${command} ${cmdArgs.join(' ')} (κωδικός ${r.status})`);
}

const freePort = (p) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
});

async function restart() {
  lib.stop('api'); lib.stop('worker');
  await new Promise((r) => setTimeout(r, 1500));
  await lib.ensure(say);
  // Passenger restarts the web app when tmp/restart.txt changes
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/restart.txt'), new Date().toISOString());
  say('Web: ζητήθηκε επανεκκίνηση (tmp/restart.txt).');
}

const commands = {
  async init() {
    if (fs.existsSync(envFile) && !args.force) die('Υπάρχει ήδη .env. Για αλλαγές επεξεργάσου το στον File Manager (ή --force για νέο, ΠΡΟΣΟΧΗ: νέα κλειδιά).');
    let db = typeof args.db === 'string' ? args.db : process.env.DATABASE_URL;
    if (!db) die('Δώσε τη βάση: npm run plesk -- init --db "postgresql://χρήστης:κωδικός@host/βάση?sslmode=require"');
    let u;
    try { u = new URL(db); } catch { die('Μη έγκυρο --db (πρέπει να ξεκινά με postgresql://)'); }
    u.searchParams.delete('channel_binding'); // not understood by the driver
    if (u.hostname.includes('-pooler.')) {
      // Neon pooler (PgBouncer) breaks LISTEN/NOTIFY (live updates): use the direct endpoint
      u.hostname = u.hostname.replace('-pooler.', '.');
      say('Σημείωση: χρησιμοποιείται η απευθείας σύνδεση της Neon (χωρίς -pooler).');
    }
    if (!u.hostname.match(/^(localhost|127\.)/) && !u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
    db = u.toString();

    const domain = typeof args.domain === 'string' ? args.domain : 'app.softify.gr';
    const base = domain.split('.').slice(-2).join('.');
    let apiPort = Number(args['api-port'] || 4517);
    for (let i = 0; i < 50 && !(await freePort(apiPort)); i++) apiPort = 4500 + Math.floor(Math.random() * 1400);
    if (!(await freePort(apiPort))) die('Δεν βρέθηκε ελεύθερη θύρα για το API. Δώσε --api-port.');

    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const priv = ecdh.getPrivateKey();
    const vapidPriv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]).toString('base64url');
    const jwt = crypto.randomBytes(48).toString('base64url');
    const adminMail = typeof args.email === 'string' ? args.email : `admin@${base}`;

    fs.writeFileSync(envFile, `# SoftifyOS (Plesk Node.js), δημιουργήθηκε ${new Date().toISOString().slice(0, 10)}. Κράτησέ το ιδιωτικό.
DATABASE_URL=${db}
DB_POOL_MAX=10
DB_PREPARE=true

API_PORT=${apiPort}
API_HOST=127.0.0.1
API_INTERNAL_URL=http://127.0.0.1:${apiPort}
APP_URL=https://${domain}
JWT_SECRET=${jwt}
COOKIE_SECURE=true

# Web Push. Μην τα αλλάξεις αργότερα: οι εγγραφές των συσκευών εξαρτώνται από αυτά.
VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}
VAPID_PRIVATE_KEY=${vapidPriv}
VAPID_SUBJECT=mailto:${adminMail}

# Mail server του Plesk
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=SoftifyOS <no-reply@${base}>

# Διαχειριστές πλατφόρμας (Ρυθμίσεις → Υγεία συστήματος)
PLATFORM_ADMINS=${adminMail}
`, { mode: 0o600 });
    say(`✓ Δημιουργήθηκε το .env (API στη θύρα ${apiPort}, ${domain}).`);
    say('Επόμενο: npm run plesk -- deploy');
  },

  async deploy() {
    if (!fs.existsSync(envFile)) die('Λείπει το .env. Τρέξε πρώτα: npm run plesk -- init --db "…"');
    fs.mkdirSync(runDir, { recursive: true });
    const log = path.join(runDir, 'deploy.log');
    if (!args.wait) {
      // Long job: run detached so the Plesk command window (or cron) can return immediately
      const out = fs.openSync(log, 'w');
      const child = spawn(process.execPath, [import.meta.filename, 'deploy', '--wait'], { cwd: root, detached: true, stdio: ['ignore', out, out], env: { ...process.env, PATH } });
      child.unref();
      say(`Η ενημέρωση ξεκίνησε στο παρασκήνιο (5–15 λεπτά).
Πρόοδος: File Manager → app.softify.gr → .run → deploy.log
Τέλος όταν γράφει «✓ Ολοκληρώθηκε». Έλεγχος: npm run plesk -- status`);
      return;
    }
    const lock = path.join(runDir, 'deploy.lock');
    try { fs.mkdirSync(lock); } catch { die('Τρέχει ήδη άλλη ενημέρωση (αν δεν τρέχει, σβήσε τον φάκελο .run/deploy.lock).'); }
    try {
      say(`Έναρξη ${new Date().toISOString()}`);
      const env = lib.readEnv();
      run('npm', ['install', '--include=dev', '--no-audit', '--no-fund', '--loglevel=error']);
      run('npm', ['run', 'build'], { NODE_ENV: 'production', API_INTERNAL_URL: env.API_INTERNAL_URL, NEXT_TELEMETRY_DISABLED: '1' });
      run('npm', ['run', 'db:migrate']);
      say('\n==> Επανεκκίνηση υπηρεσιών');
      await restart();
      say(`\n✓ Ολοκληρώθηκε ${new Date().toISOString()}`);
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  },

  async migrate() { run('npm', ['run', 'db:migrate']); },
  async ensure() { await lib.ensure(say); },
  async restart() { await restart(); },
  async stop() { say(`API: ${lib.stop('api') || '-'}, Worker: ${lib.stop('worker') || '-'}`); },

  async admin() {
    const pwFile = path.join(root, 'admin-password.txt');
    if (!fs.existsSync(pwFile)) die('Φτιάξε στον File Manager το αρχείο admin-password.txt (στη ρίζα της εφαρμογής) με μόνο τον κωδικό μέσα.');
    const password = fs.readFileSync(pwFile, 'utf8').trim();
    fs.unlinkSync(pwFile);
    const pass = rest.filter((a) => a !== '--wait');
    try { run('npm', ['run', 'tenant:create', '--', ...pass], { SOFTIFY_PASSWORD: password }); }
    finally { say('Το admin-password.txt σβήστηκε.'); }
  },

  async status() {
    const env = lib.readEnv();
    say(`.env: ${fs.existsSync(envFile) ? 'ναι' : 'ΟΧΙ (npm run plesk -- init)'}`);
    say(`Build: ${fs.existsSync(path.join(lib.webDir, 'server.js')) && fs.existsSync(path.join(lib.apiDir, 'dist/src/server.js')) ? 'ναι' : 'ΟΧΙ (npm run plesk -- deploy)'}`);
    say(`API pid: ${lib.alivePid('api') || '-'}, Worker pid: ${lib.alivePid('worker') || '-'}`);
    if (env.API_PORT) {
      try {
        const r = await fetch(`http://127.0.0.1:${env.API_PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
        say(`Health (${r.status}): ${(await r.text()).slice(0, 1500)}`);
      } catch (e) { say(`Health: το API δεν απαντά (${e.message}). Δες .run/api.log`); }
    }
  },
};

if (!commands[cmd]) die(`Άγνωστη εντολή «${cmd}». Διαθέσιμες: ${Object.keys(commands).join(', ')}`);
await commands[cmd]();
