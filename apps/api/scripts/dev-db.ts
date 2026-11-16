// Local development PostgreSQL (real Postgres binaries via the embedded-postgres package).
// Production uses your own PostgreSQL on the Plesk server - see deploy/PLESK.md.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '../../../.pgdev');
const port = Number(process.env.DEV_PG_PORT ?? 5434);

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const fresh = !existsSync(dir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('softifyos');
console.log(`Dev PostgreSQL ready: postgres://postgres:postgres@localhost:${port}/softifyos`);

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
