// Demo stores & spaces for bulk-generated customers (codes "C…"), so the "Customers & stores"
// and "Stores" views have realistic volume. Additive: only customers without stores are touched.
//   npm run db:seed:branches          (also called by db:seed)
import postgres from 'postgres';

const CITIES = [
  'Αθήνα', 'Θεσσαλονίκη', 'Πειραιάς', 'Πάτρα', 'Ηράκλειο', 'Λάρισα', 'Βόλος', 'Ιωάννινα', 'Χανιά', 'Καλαμάτα',
  'Μαρούσι', 'Γλυφάδα', 'Κηφισιά', 'Περιστέρι', 'Χαλάνδρι', 'Ρόδος', 'Κέρκυρα', 'Σέρρες', 'Καβάλα', 'Αλεξανδρούπολη',
];
const STREETS = ['Ερμού', 'Σταδίου', 'Πανεπιστημίου', 'Κηφισίας', 'Βασ. Σοφίας', 'Αθηνάς', 'Τσιμισκή', 'Εγνατίας', 'Μητροπόλεως', 'Αγ. Νικολάου'];

export async function seedDemoBranches(sql: postgres.Sql, tenantIds: string[], log: (m: string) => void = console.log) {
  if (!tenantIds.length) return;
  // ~2 out of 3 customers get 1–4 stores
  const [b] = await sql`
    WITH c AS (
      SELECT id, tenant_id, row_number() OVER (ORDER BY id) AS rn
      FROM customers
      WHERE tenant_id = ANY(${tenantIds}::uuid[]) AND code LIKE 'C%' AND branches_count = 0
    ), ins AS (
      INSERT INTO branches (tenant_id, customer_id, name, city, address, postal_code, phone, status)
      SELECT c.tenant_id, c.id,
             (ARRAY['Κεντρικό κατάστημα','Υποκατάστημα','Κατάστημα','Showroom','Αποθήκη'])[1 + (g + c.rn) % 5] || ' ' || g,
             (${CITIES}::text[])[1 + (c.rn * 7 + g * 3) % ${CITIES.length}],
             (${STREETS}::text[])[1 + (c.rn + g) % ${STREETS.length}] || ' ' || (1 + (c.rn * 13 + g) % 180),
             lpad((10431 + (c.rn * 37 + g) % 74000)::text, 5, '0'),
             '210' || lpad(((c.rn * 7919 + g) % 10000000)::text, 7, '0'),
             CASE WHEN (c.rn + g) % 11 = 0 THEN 'inactive' ELSE 'active' END
      FROM c CROSS JOIN LATERAL generate_series(1, 1 + (c.rn % 4)::int) g
      WHERE abs(hashtext(c.id::text)) % 3 <> 0  -- deterministic: re-runs skip the same customers
      RETURNING 1)
    SELECT count(*)::int AS n FROM ins`;
  log(`demo stores: ${b.n.toLocaleString()}`);

  // 1–5 spaces per new store
  const [s] = await sql`
    WITH nb AS (
      SELECT b.id, b.tenant_id, abs(hashtext(b.id::text)) AS h
      FROM branches b
      WHERE b.tenant_id = ANY(${tenantIds}::uuid[]) AND b.spaces_count = 0
        AND NOT EXISTS (SELECT 1 FROM spaces s WHERE s.branch_id = b.id)
    ), ins AS (
      INSERT INTO spaces (tenant_id, branch_id, name, kind, area_sqm)
      SELECT nb.tenant_id, nb.id,
             (ARRAY['Εμπορικός χώρος','Αποθήκη','Γραφεία','Τμήμα'])[1 + (g + nb.h) % 4] || ' ' || g,
             (ARRAY['Εμπορικός χώρος','Αποθήκη','Γραφεία','Τμήμα / Διεύθυνση'])[1 + (g + nb.h) % 4],
             (20 + (nb.h + g * 97) % 480)::numeric
      FROM nb CROSS JOIN LATERAL generate_series(1, 1 + (nb.h % 5)::int) g
      RETURNING 1)
    SELECT count(*)::int AS n FROM ins`;
  log(`demo spaces: ${s.n.toLocaleString()}`);

  // Exact denormalised counters
  await sql`
    UPDATE branches b SET spaces_count = x.n
    FROM (SELECT branch_id, count(*)::int AS n FROM spaces WHERE tenant_id = ANY(${tenantIds}::uuid[]) GROUP BY 1) x
    WHERE b.id = x.branch_id AND b.spaces_count <> x.n`;
  await sql`
    UPDATE customers c SET branches_count = x.bc, spaces_count = x.sc
    FROM (SELECT customer_id, count(*)::int AS bc, sum(spaces_count)::int AS sc
          FROM branches WHERE tenant_id = ANY(${tenantIds}::uuid[]) GROUP BY 1) x
    WHERE c.id = x.customer_id AND (c.branches_count <> x.bc OR c.spaces_count <> x.sc)`;
  log('demo store counters updated');
}

// City → [prefecture, geographic zone] for the demo cities
const CITY_GEO: Record<string, [string, string]> = {
  'Αθήνα': ['Αττικής', 'Αττική'], 'Πειραιάς': ['Αττικής', 'Αττική'], 'Μαρούσι': ['Αττικής', 'Αττική'], 'Γλυφάδα': ['Αττικής', 'Αττική'],
  'Κηφισιά': ['Αττικής', 'Αττική'], 'Περιστέρι': ['Αττικής', 'Αττική'], 'Χαλάνδρι': ['Αττικής', 'Αττική'],
  'Θεσσαλονίκη': ['Θεσσαλονίκης', 'Βόρεια Ελλάδα'], 'Σέρρες': ['Σερρών', 'Βόρεια Ελλάδα'], 'Καβάλα': ['Καβάλας', 'Βόρεια Ελλάδα'],
  'Αλεξανδρούπολη': ['Έβρου', 'Βόρεια Ελλάδα'], 'Λάρισα': ['Λαρίσης', 'Κεντρική Ελλάδα'], 'Βόλος': ['Μαγνησίας', 'Κεντρική Ελλάδα'],
  'Ιωάννινα': ['Ιωαννίνων', 'Δυτική Ελλάδα'], 'Πάτρα': ['Αχαΐας', 'Δυτική Ελλάδα'], 'Καλαμάτα': ['Μεσσηνίας', 'Πελοπόννησος'],
  'Ηράκλειο': ['Ηρακλείου', 'Κρήτη'], 'Χανιά': ['Χανίων', 'Κρήτη'], 'Ρόδος': ['Δωδεκανήσου', 'Νησιά Αιγαίου'], 'Κέρκυρα': ['Κερκύρας', 'Ιόνια Νησιά'],
};
const TOURS: Record<string, string> = {
  'Αττική': 'Εξόρμηση Αττικής', 'Βόρεια Ελλάδα': 'Εξόρμηση Βορείου Ελλάδος', 'Κεντρική Ελλάδα': 'Εξόρμηση Κεντρικής Ελλάδος',
  'Κρήτη': 'Εξόρμηση Κρήτης', 'Νησιά Αιγαίου': 'Εξόρμηση Νησιών', 'Ιόνια Νησιά': 'Εξόρμηση Νησιών',
};

/** Fill prefecture / zone / fee schedule / tour / seasonality on demo stores that don't have them yet. */
export async function seedDemoBranchAttributes(sql: postgres.Sql, tenantIds: string[], log: (m: string) => void = console.log) {
  for (const T of tenantIds) {
    await sql`SELECT provision_lookups(${T})`;
    for (const name of ['Βασικό αμοιβολόγιο', 'Premium αμοιβολόγιο', 'Αμοιβολόγιο νησιών']) {
      await sql`INSERT INTO lookup_values (tenant_id, list, name) VALUES (${T}, 'fee_schedule', ${name}) ON CONFLICT DO NOTHING`;
    }
    for (const name of new Set(Object.values(TOURS))) {
      await sql`INSERT INTO lookup_values (tenant_id, list, name) VALUES (${T}, 'tour', ${name}) ON CONFLICT DO NOTHING`;
    }
    const map = Object.entries(CITY_GEO).map(([city, [region, zone]]) => ({ city, region, zone, tour: TOURS[zone] ?? null }));
    const [r] = await sql`
      WITH m AS (SELECT * FROM jsonb_to_recordset(${sql.json(map)}::jsonb) AS x(city text, region text, zone text, tour text)),
      upd AS (
        UPDATE branches b SET
          region = m.region,
          geo_zone_id = (SELECT id FROM lookup_values WHERE tenant_id = b.tenant_id AND list = 'geo_zone' AND name = m.zone),
          -- every 3rd store is on a field tour of its zone
          tour_id = CASE WHEN abs(hashtext(b.id::text)) % 3 = 0
                         THEN (SELECT id FROM lookup_values WHERE tenant_id = b.tenant_id AND list = 'tour' AND name = m.tour) END,
          fee_schedule_id = (SELECT id FROM lookup_values WHERE tenant_id = b.tenant_id AND list = 'fee_schedule'
                             AND name = CASE WHEN m.zone IN ('Νησιά Αιγαίου','Ιόνια Νησιά','Κρήτη') THEN 'Αμοιβολόγιο νησιών'
                                             WHEN abs(hashtext(b.id::text)) % 4 = 0 THEN 'Premium αμοιβολόγιο' ELSE 'Βασικό αμοιβολόγιο' END),
          seasonality = CASE WHEN m.zone IN ('Νησιά Αιγαίου','Ιόνια Νησιά') THEN 'summer' ELSE 'all_year' END
        FROM m
        WHERE b.tenant_id = ${T} AND b.city = m.city AND b.region IS NULL
        RETURNING 1)
      SELECT count(*)::int AS n FROM upd`;
    log(`demo store attributes: ${r.n.toLocaleString()} stores`);
  }
}

// CLI: npm run db:seed:branches
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('demo-branches.ts')) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if ((process.env.NODE_ENV === 'production' || process.env.APP_URL?.startsWith('https://')) && process.env.SEED_FORCE !== 'yes') {
    console.error('✗ Demo δεδομένα: δεν τρέχουν σε παραγωγή.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const tenants = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = 'acme-demo' OR slug LIKE 'tenant-%'`;
  const t0 = Date.now();
  await seedDemoBranches(sql, tenants.map((t) => t.id));
  await seedDemoBranchAttributes(sql, tenants.map((t) => t.id));
  await sql`ANALYZE branches`;
  await sql`ANALYZE spaces`;
  console.log(`✓ done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await sql.end();
}
