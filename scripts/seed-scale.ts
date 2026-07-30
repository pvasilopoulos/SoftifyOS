import "dotenv/config";
import { Pool } from "pg";

/**
 * Bulk-seed audit_events for scale proof.
 * Default: 1_000_000 rows for tenant `akropolis`.
 *
 * Usage:
 *   npm run db:seed:scale
 *   SCALE_ROWS=1000000 npm run db:seed:scale
 */
async function main() {
  const rows = Number(process.env.SCALE_ROWS ?? 1_000_000);
  if (!Number.isFinite(rows) || rows < 1) {
    throw new Error("SCALE_ROWS must be a positive number");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const tenant = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      ["akropolis"],
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) {
      throw new Error("Tenant akropolis not found. Run npm run db:seed first.");
    }

    const user = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      ["maria@akropolis.gr"],
    );
    const userId = user.rows[0]?.id ?? null;

    console.log(`Seeding ${rows.toLocaleString("en-US")} audit_events...`);
    const t0 = performance.now();

    // Remove previous scale rows only (keep login/seed audits)
    await client.query(
      `DELETE FROM audit_events
       WHERE "tenantId" = $1 AND action LIKE 'scale.%'`,
      [tenantId],
    );

    // Fast set-based insert via generate_series
    await client.query(
      `
      INSERT INTO audit_events (
        id, "tenantId", "userId", action, entity, "entityId", meta, "createdAt"
      )
      SELECT
        replace(gen_random_uuid()::text, '-', ''),
        $1,
        $2,
        CASE (g % 5)
          WHEN 0 THEN 'scale.invoice.view'
          WHEN 1 THEN 'scale.invoice.update'
          WHEN 2 THEN 'scale.stock.move'
          WHEN 3 THEN 'scale.order.create'
          ELSE 'scale.login.attempt'
        END,
        CASE (g % 3)
          WHEN 0 THEN 'invoice'
          WHEN 1 THEN 'stock_movement'
          ELSE 'order'
        END,
        'scale-' || g::text,
        jsonb_build_object('n', g, 'source', 'seed:scale'),
        NOW() - ((g % 365) || ' days')::interval - ((g % 86400) || ' seconds')::interval
      FROM generate_series(1, $3) AS g
      `,
      [tenantId, userId, rows],
    );

    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_events WHERE "tenantId" = $1`,
      [tenantId],
    );

    // Analyze for planner stats after bulk load
    await client.query(`ANALYZE audit_events`);

    const ms = Math.round(performance.now() - t0);
    console.log(`Done in ${(ms / 1000).toFixed(1)}s`);
    console.log(`Tenant audit_events total: ${count.rows[0]?.count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
