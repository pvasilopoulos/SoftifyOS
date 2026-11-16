// Applies db/migrations/*.sql in order, once each (tracked in schema_migrations).
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = resolve(import.meta.dirname, '../db/migrations');

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const done = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  process.stdout.write(`Applying ${file} ... `);
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(resolve(dir, file), 'utf8'));
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
  console.log('ok');
}
console.log('Migrations up to date.');
await sql.end();
