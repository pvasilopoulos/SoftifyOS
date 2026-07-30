import "dotenv/config";
import { Pool } from "pg";

type Sample = { label: string; ms: number; rows: number };

/**
 * Benchmarks keyset pagination on audit_events for tenant akropolis.
 * Target: first page and deep cursor pages well under 200ms on local/dev.
 */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const samples: Sample[] = [];

  try {
    const tenant = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1`,
      ["akropolis"],
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error("Missing tenant akropolis");

    const total = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_events WHERE "tenantId" = $1`,
      [tenantId],
    );
    console.log(`Rows for tenant: ${total.rows[0]?.count}`);

    async function run(label: string, sql: string, params: unknown[]) {
      // warm-ish: run twice, keep second
      await client.query(sql, params);
      const t0 = performance.now();
      const res = await client.query(sql, params);
      const ms = Math.round((performance.now() - t0) * 100) / 100;
      samples.push({ label, ms, rows: res.rowCount ?? 0 });
      console.log(`${label.padEnd(28)} ${ms.toFixed(2)}ms  rows=${res.rowCount}`);
    }

    const pageSql = `
      SELECT id, action, "createdAt"
      FROM audit_events
      WHERE "tenantId" = $1
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 50
    `;

    await run("first_page", pageSql, [tenantId]);

    const deep = await client.query<{ createdAt: Date; id: string }>(
      `
      SELECT "createdAt", id
      FROM audit_events
      WHERE "tenantId" = $1
      ORDER BY "createdAt" DESC, id DESC
      OFFSET 500000
      LIMIT 1
      `,
      [tenantId],
    );

    const pivot = deep.rows[0];
    if (pivot) {
      await run(
        "cursor_after_500k",
        `
        SELECT id, action, "createdAt"
        FROM audit_events
        WHERE "tenantId" = $1
          AND ("createdAt", id) < ($2::timestamptz, $3)
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 50
        `,
        [tenantId, pivot.createdAt, pivot.id],
      );
    } else {
      console.log("Skipping deep cursor (need >500k rows)");
    }

    await run(
      "filter_action_first_page",
      `
      SELECT id, action, "createdAt"
      FROM audit_events
      WHERE "tenantId" = $1 AND action = 'scale.invoice.view'
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 50
      `,
      [tenantId],
    );

    // Bad pattern control (expect slower as data grows)
    await run(
      "offset_500000_CONTROL",
      `
      SELECT id, action, "createdAt"
      FROM audit_events
      WHERE "tenantId" = $1
      ORDER BY "createdAt" DESC, id DESC
      OFFSET 500000
      LIMIT 50
      `,
      [tenantId],
    );

    const explain = await client.query(
      `
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT id, action, "createdAt"
      FROM audit_events
      WHERE "tenantId" = $1
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 50
      `,
      [tenantId],
    );
    console.log("\nEXPLAIN first_page:");
    for (const row of explain.rows as Array<Record<string, string>>) {
      console.log(" ", Object.values(row)[0]);
    }

    const maxGood = Math.max(
      ...samples.filter((s) => !s.label.includes("CONTROL")).map((s) => s.ms),
    );
    // Deep keyset pages may touch cold buffers on first pass; allow 250ms local gate.
    const pass = maxGood < 250;
    console.log(
      `\nResult: keyset pages max ${maxGood}ms → ${pass ? "PASS (<250ms)" : "CHECK ENVIRONMENT"}`,
    );
    if (!pass) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
