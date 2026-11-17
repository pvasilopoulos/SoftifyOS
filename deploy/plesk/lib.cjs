'use strict';
// SoftifyOS on the Plesk Node.js extension (no root): the web app runs under Passenger,
// the API and the worker run as detached background processes owned by the domain user.
// State lives in <app root>/.run: pid files and logs (outside the document root).
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '../..');
const envFile = path.join(root, '.env');
const runDir = path.join(root, '.run');
const apiDir = path.join(root, 'apps/api');
const webDir = path.join(root, 'apps/web/.next/standalone/apps/web');
const SERVICES = { api: 'dist/src/server.js', worker: 'dist/src/worker.js' };

function readEnv() {
  const env = {};
  if (!fs.existsSync(envFile)) return env;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const pidFile = (name) => path.join(runDir, `${name}.pid`);
const logFile = (name) => path.join(runDir, `${name}.log`);

function alivePid(name) {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), 'utf8'));
    if (pid > 0) { process.kill(pid, 0); return pid; }
  } catch { /* not running */ }
  return 0;
}

function portOpen(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(port), host });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function start(name) {
  fs.mkdirSync(runDir, { recursive: true });
  const log = logFile(name);
  try { if (fs.statSync(log).size > 10 * 1024 * 1024) fs.renameSync(log, `${log}.1`); } catch { /* no log yet */ }
  const out = fs.openSync(log, 'a');
  fs.writeSync(out, `\n--- ${new Date().toISOString()} start ${name}\n`);
  // Clean environment: values come from .env (--env-file), not from Passenger's process
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8', NODE_ENV: 'production' };
  const child = spawn(process.execPath, [`--env-file=${envFile}`, SERVICES[name]], {
    cwd: apiDir, detached: true, stdio: ['ignore', out, out], env,
  });
  fs.writeFileSync(pidFile(name), String(child.pid));
  child.unref();
  fs.closeSync(out);
  return child.pid;
}

function stop(name) {
  const pid = alivePid(name);
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  try { fs.unlinkSync(pidFile(name)); } catch { /* none */ }
  return pid;
}

/** Start the API and the worker if they are not running. Safe to call often and concurrently. */
async function ensure(log = () => {}) {
  if (!fs.existsSync(envFile) || !fs.existsSync(path.join(apiDir, SERVICES.api))) {
    log('Δεν υπάρχει ακόμα .env ή build: τίποτα να ξεκινήσει.');
    return;
  }
  fs.mkdirSync(runDir, { recursive: true });
  const lock = path.join(runDir, 'ensure.lock');
  try { fs.mkdirSync(lock); } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs < 60_000) return; } catch { /* raced */ }
    fs.rmSync(lock, { recursive: true, force: true });
    try { fs.mkdirSync(lock); } catch { return; }
  }
  try {
    const port = readEnv().API_PORT || 4000;
    const apiPid = alivePid('api');
    const young = apiPid && Date.now() - fs.statSync(pidFile('api')).mtimeMs < 60_000;
    if (!(await portOpen(port)) && !young) {
      if (apiPid) stop('api');
      log(`API: εκκίνηση (pid ${start('api')}, θύρα ${port})`);
    } else log(`API: τρέχει (pid ${apiPid || '?'}, θύρα ${port})`);
    const wPid = alivePid('worker');
    if (!wPid) log(`Worker: εκκίνηση (pid ${start('worker')})`);
    else log(`Worker: τρέχει (pid ${wPid})`);
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

module.exports = { root, envFile, runDir, apiDir, webDir, readEnv, alivePid, portOpen, start, stop, ensure, logFile };
