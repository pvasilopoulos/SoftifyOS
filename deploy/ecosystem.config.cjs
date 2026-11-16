// PM2 process file for the Plesk server.
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
// Scale: increase `instances` for api/web (cluster mode) and run more worker processes as load grows.
const path = require('path');
const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');

module.exports = {
  apps: [
    {
      name: 'softify-web',
      cwd: path.join(root, 'apps/web/.next/standalone/apps/web'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3000, HOSTNAME: '127.0.0.1' },
      max_memory_restart: '600M',
    },
    {
      name: 'softify-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/src/server.js',
      node_args: `--env-file=${envFile}`,
      instances: 2, // several instances share realtime events via Postgres LISTEN/NOTIFY
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
