// PM2 process file.   pm2 startOrReload deploy/ecosystem.config.cjs && pm2 save
// Ports come from .env (WEB_PORT / API_PORT). Scale by raising `instances` for api/web,
// and run more worker processes as load grows.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');

const env = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

module.exports = {
  apps: [
    {
      name: 'softify-web',
      cwd: path.join(root, 'apps/web/.next/standalone/apps/web'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: env.WEB_PORT || 3000, HOSTNAME: '127.0.0.1' },
      max_memory_restart: '600M',
    },
    {
      name: 'softify-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/src/server.js',
      node_args: `--env-file=${envFile}`,
      instances: 2, // instances share realtime events via Postgres LISTEN/NOTIFY
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
    },
    {
      name: 'softify-worker',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/src/worker.js',
      node_args: `--env-file=${envFile}`,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
    },
  ],
};
