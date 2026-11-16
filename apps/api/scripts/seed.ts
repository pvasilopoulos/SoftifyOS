// Seeds a demo tenant with realistic data + bulk-generated volume for load testing.
//   npm run db:seed                       -> demo tenant + 100k customers, 300k offers, 1M activities
//   SEED_SCALE=10 npm run db:seed         -> x10 (1M customers, 3M offers, 10M activities)
//   SEED_TENANTS=50 npm run db:seed       -> extra tenants with their own data (multitenant realism)
// Bulk rows are generated inside PostgreSQL with generate_series (fast, no network round trips).
import postgres from 'postgres';
import { hash } from '@node-rs/argon2';
import { seedDemoBranchAttributes, seedDemoBranches } from './demo-branches.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
// Safety: demo data deletes and recreates tenants. Never run it against production by accident.
if ((process.env.NODE_ENV === 'production' || process.env.APP_URL?.startsWith('https://')) && process.env.SEED_FORCE !== 'yes') {
  console.error('✗ Το seed φτιάχνει demo δεδομένα και δεν τρέχει σε παραγωγή. Για τον πρώτο οργανισμό: npm run tenant:create');
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const scale = Number(process.env.SEED_SCALE ?? 1);
const extraTenants = Number(process.env.SEED_TENANTS ?? 3);
// Local test login (development only)
const DEMO_EMAIL = process.env.SEED_EMAIL ?? 'demo@softifyos.local';
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Demo!2026';

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// Remove previous demo tenants FIRST, with triggers on: ON DELETE CASCADE runs as a trigger,
// so deleting in "replica" mode would leave orphaned rows behind.
const slugs = ['acme-demo', ...Array.from({ length: extraTenants }, (_, i) => `tenant-${i + 1}`)];
await sql`DELETE FROM tenants WHERE slug = ANY(${slugs})`;
// Clean up rows orphaned by older seed versions (had the bug above)
for (const t of ['activities', 'offer_items', 'offer_approvals', 'offer_versions', 'offers', 'events', 'notifications',
  'push_subscriptions', 'contacts', 'spaces', 'branches', 'customers', 'companies', 'products', 'approval_flow_steps',
  'tenant_offer_stats', 'tenant_counters', 'memberships']) {
  const r = await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id NOT IN (SELECT id FROM tenants)`);
  if (r.count) log(`removed ${r.count.toLocaleString()} orphaned rows from ${t}`);
}

// Skip per-row triggers during bulk load when allowed (superuser); stats are recomputed afterwards.
try { await sql`SET session_replication_role = replica`; log('Bulk mode: triggers off'); }
catch { log('Bulk mode unavailable (not superuser): triggers stay on, seeding is slower'); }

const pw = await hash(DEMO_PASSWORD);

async function seedTenant(slug: string, name: string, customers: number, withDemoUser: boolean) {
  const [tenant] = await sql<{ id: string }[]>`INSERT INTO tenants (slug, name) VALUES (${slug}, ${name}) RETURNING id`;
  const T = tenant.id;

  const people = [
    ['Γιάννης Παπαδόπουλος', 'Sales Manager', 'owner'],
    ['Μαρία Κωνσταντίνου', 'Account Manager', 'sales'],
    ['Ελένη Νικολάου', 'Εμπορική Διευθύντρια', 'manager'],
  ] as const;
  const userIds: string[] = [];
  for (const [i, [full, title, role]] of people.entries()) {
    const email = withDemoUser && i === 0 ? DEMO_EMAIL : `user${i}@${slug}.local`;
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, full_name) VALUES (${email}, ${pw}, ${full})
      ON CONFLICT (lower(email)) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`;
    await sql`INSERT INTO memberships (tenant_id, user_id, role, title) VALUES (${T}, ${u.id}, ${role}, ${title})`;
    userIds.push(u.id);
  }
  const [company] = await sql<{ id: string }[]>`INSERT INTO companies (tenant_id, name, vat) VALUES (${T}, ${name + ' Services A.E.'}, '099999999') RETURNING id`;

  // Hand-written showcase records (match the design mockups)
  const showcase = [
    ['ACME Group', 'group', 'active', 'Στρατηγικός Πελάτης', 820000],
    ['RetailCo A.E.', 'company', 'active', null, 320000],
    ['Global Foods', 'company', 'active', null, 410000],
    ['City Malls', 'company', 'negotiation', null, 150000],
  ] as const;
  const showcaseIds: string[] = [];
  for (const [i, [cname, kind, status, category, value]] of showcase.entries()) {
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO customers (tenant_id, code, kind, name, vat, status, category, account_manager_id, annual_value)
      VALUES (${T}, ${'CUST-' + String(482 + i).padStart(6, '0')}, ${kind}, ${cname}, ${'09456789' + i}, ${status}, ${category}, ${userIds[i % 2]}, ${value})
      RETURNING id`;
    showcaseIds.push(c.id);
  }
  const acme = showcaseIds[0];
  const branches = [['Κεντρικά Γραφεία', 'Αθήνα', 5], ['ACME Retail – Κατάστημα 01', 'Μαρούσι', 3], ['ACME Retail – Κατάστημα 02', 'Γλυφάδα', 4]] as const;
  for (const [bname, city, n] of branches) {
    const [b] = await sql<{ id: string }[]>`INSERT INTO branches (tenant_id, customer_id, name, city, spaces_count) VALUES (${T}, ${acme}, ${bname}, ${city}, ${n}) RETURNING id`;
    await sql`INSERT INTO spaces (tenant_id, branch_id, name, kind)
              SELECT ${T}, ${b.id}, 'Χώρος ' || g, (ARRAY['retail','warehouse','office','department'])[1 + g % 4]
              FROM generate_series(1, ${n}) g`;
  }
  await sql`UPDATE customers SET companies_count = 3, branches_count = 3, spaces_count = 12 WHERE id = ${acme}`;
  await sql`INSERT INTO contacts (tenant_id, customer_id, full_name, email, phone, role_title)
            VALUES (${T}, ${acme}, 'Νίκος Αλεξίου', 'n.alexiou@acme.example', '+30 210 0000000', 'Procurement')`;

  // Default approval flow + product catalogue
  await sql`SELECT provision_tenant(${T})`;
  const catalogue = await sql<{ id: string; sku: string; name: string; unit: string; unit_price: string }[]>`
    SELECT id, sku, name, unit, unit_price FROM products WHERE tenant_id = ${T}`;
  const p = (sku: string) => catalogue.find((x) => x.sku === sku)!;

  // Showcase offers with real versions, line items and approvals
  const offers = [
    ['OFF-2026-0048', 3, 'pending_approval', 0, [['EQP-102', 14], ['EQP-105', 4], ['EQP-101', 60], ['SRV-002', 120]]],
    ['OFF-2026-0047', 2, 'approved', 1, [['EQP-103', 12], ['LIC-201', 25], ['SRV-001', 40]]],
    ['OFF-2026-0046', 1, 'sent', 2, [['EQP-104', 150], ['SRV-002', 60], ['SRV-003', 2]]],
    ['OFF-2026-0045', 4, 'accepted', 3, [['EQP-102', 30], ['EQP-105', 10], ['EQP-101', 120], ['SRV-003', 5]]],
  ] as const;
  for (const [num, ver, status, ci, lines] of offers) {
    const [o] = await sql<{ id: string }[]>`
      INSERT INTO offers (tenant_id, number, customer_id, company_id, owner_id, status, current_version, valid_until,
                          sent_at, responded_at, responder_name)
      VALUES (${T}, ${num}, ${showcaseIds[ci]}, ${company.id}, ${userIds[0]}, ${status}, ${ver}, current_date + 45,
              ${status === 'sent' || status === 'accepted' ? sql`now() - interval '3 days'` : null},
              ${status === 'accepted' ? sql`now() - interval '1 day'` : null},
              ${status === 'accepted' ? 'Νίκος Αλεξίου' : null})
      RETURNING id`;
    let totals = { net: 0, vat: 0 };
    for (let v = 1; v <= ver; v++) {
      // Earlier versions were ~8% more expensive per version (typical negotiation)
      const factor = 1 + (ver - v) * 0.08;
      const items = lines.map(([sku, qty], i) => {
        const prod = p(sku);
        const net = Math.round(qty * Number(prod.unit_price) * factor * 100) / 100;
        return { i, prod, qty, price: Math.round(Number(prod.unit_price) * factor * 100) / 100, net, vat: Math.round(net * 24) / 100 };
      });
      const net = items.reduce((a, x) => a + x.net, 0), vat = items.reduce((a, x) => a + x.vat, 0);
      const [vr] = await sql<{ id: string }[]>`
        INSERT INTO offer_versions (tenant_id, offer_id, version, net_amount, vat_amount, total_amount, created_by, created_at)
        VALUES (${T}, ${o.id}, ${v}, ${net}, ${vat}, ${net + vat}, ${userIds[0]}, now() - ${(ver - v) * 3 + 1} * interval '1 day')
        RETURNING id`;
      for (const it of items) {
        await sql`INSERT INTO offer_items (tenant_id, version_id, position, product_id, description, unit, quantity, unit_price, vat_rate, net_amount, vat_amount)
                  VALUES (${T}, ${vr.id}, ${it.i + 1}, ${it.prod.id}, ${it.prod.name}, ${it.prod.unit}, ${it.qty}, ${it.price}, 24, ${it.net}, ${it.vat})`;
      }
      totals = { net, vat };
    }
    await sql`UPDATE offers SET net_amount = ${totals.net}, vat_amount = ${totals.vat}, total_amount = ${totals.net + totals.vat} WHERE id = ${o.id}`;
    const steps = totals.net >= 50000 ? 2 : 1;
    const pending = status === 'pending_approval';
    await sql`INSERT INTO offer_approvals (tenant_id, offer_id, version, step, title, required_role, approver_id, status, decided_at)
              SELECT ${T}, ${o.id}, ${ver}, s.step, s.title, s.required_role,
                     ${pending ? null : userIds[2]}, ${pending ? 'pending' : 'approved'}, ${pending ? null : sql`now() - interval '2 days'`}
              FROM approval_flow_steps s WHERE s.tenant_id = ${T} AND s.step <= ${steps}`;
  }
  await sql`INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${T}, 'offer_seq:2026', 48)
            ON CONFLICT (tenant_id, key) DO UPDATE SET value = 48`;
  await sql`INSERT INTO activities (tenant_id, customer_id, actor_id, kind, title, body, occurred_at) VALUES
    (${T}, ${acme}, ${userIds[0]}, 'offer_updated', 'Προσφορά ενημερώθηκε', 'OFF-2026-0048 · v.03', now() - interval '1 hour'),
    (${T}, ${acme}, ${userIds[1]}, 'meeting_done', 'Ραντεβού ολοκληρώθηκε', 'Εμπορική παρουσίαση – Κατάστημα 01', now() - interval '4 hours'),
    (${T}, ${acme}, ${userIds[0]}, 'email_sent', 'Email στάλθηκε', 'Νέα έκδοση προσφοράς (v.03)', now() - interval '1 day'),
    (${T}, ${acme}, ${userIds[2]}, 'approval', 'Έγκριση προσφοράς', 'Εσωτερική έγκριση από Εμπορικό Διευθυντή', now() - interval '28 hours'),
    (${T}, ${acme}, ${userIds[1]}, 'call', 'Τηλεφωνική επικοινωνία', 'Συζήτηση για προδιαγραφές έργου', now() - interval '6 days')`;
  await sql`INSERT INTO events (tenant_id, owner_id, customer_id, kind, title, location, starts_at, ends_at, remind_at) VALUES
    (${T}, ${userIds[0]}, ${acme}, 'meeting', 'Συνάντηση με ACME Group', 'Κεντρικά Γραφεία', date_trunc('day', now()) + interval '9 hours', date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '8 hours 45 minutes'),
    (${T}, ${userIds[0]}, ${acme}, 'visit', 'Επιτόπια επίσκεψη', 'Κατάστημα 01', date_trunc('day', now()) + interval '10 hours 30 minutes', date_trunc('day', now()) + interval '11 hours 30 minutes', null),
    (${T}, ${userIds[0]}, null, 'internal', 'Εσωτερική σύσκεψη πωλήσεων', 'Ομάδα Commercial', date_trunc('day', now()) + interval '12 hours', date_trunc('day', now()) + interval '13 hours', null),
    (${T}, ${userIds[0]}, ${showcaseIds[1]}, 'presentation', 'Παρουσίαση προσφοράς', 'RetailCo A.E.', date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '15 hours', null),
    (${T}, ${userIds[0]}, ${showcaseIds[2]}, 'followup', 'Follow-up προσφοράς', 'Global Foods', date_trunc('day', now()) + interval '15 hours 30 minutes', date_trunc('day', now()) + interval '16 hours', null)`;

  // ---- Bulk volume ----
  const C = customers, O = customers * 3, A = customers * 10;
  await sql`
    INSERT INTO customers (tenant_id, code, kind, name, vat, status, account_manager_id, annual_value, created_at)
    SELECT ${T}, 'C' || lpad(g::text, 8, '0'), 'company',
           (ARRAY['Alpha','Beta','Delta','Omega','Nova','Astra','Helios','Aegean','Olympus','Kronos','Ionian','Atlas'])[1 + g % 12]
             || ' ' || (ARRAY['Retail','Foods','Logistics','Trading','Systems','Energy','Pharma','Hotels','Market','Tech'])[1 + (g / 12) % 10]
             || ' ' || (ARRAY['Α.Ε.','Ε.Π.Ε.','Ι.Κ.Ε.','Ο.Ε.'])[1 + g % 4] || ' #' || g,
           lpad((100000000 + g)::text, 9, '0'),
           (ARRAY['active','active','active','prospect','negotiation','inactive'])[1 + g % 6],
           (${sql.array(userIds)}::uuid[])[1 + g % 3],
           (g % 500) * 1000,
           now() - (g % 900) * interval '1 day'
    FROM generate_series(1, ${C}) g`;
  log(`${slug}: ${C.toLocaleString()} customers`);

  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE tmp_c ON COMMIT DROP AS SELECT id, row_number() OVER () AS rn FROM customers WHERE tenant_id = ${T} AND code LIKE 'C%'`;
    await tx`CREATE INDEX ON tmp_c (rn)`;
    await tx`
      INSERT INTO offers (tenant_id, number, customer_id, company_id, owner_id, status, current_version, net_amount, vat_amount, total_amount, valid_until, created_at)
      SELECT ${T}, 'OFF-B-' || lpad(g::text, 9, '0'), c.id, ${company.id}, (${tx.array(userIds)}::uuid[])[1 + g % 3],
             (ARRAY['draft','in_progress','pending_approval','approved','sent','accepted','rejected'])[1 + g % 7],
             1 + g % 4, n, round(n * 0.24, 2), round(n * 1.24, 2), current_date + (g % 90),
             now() - (g % 700) * interval '1 day'
      FROM generate_series(1, ${O}) g
      CROSS JOIN LATERAL (SELECT ((g::bigint * 7919) % 250000 + 500)::numeric(14,2) AS n) v
      JOIN tmp_c c ON c.rn = 1 + (g % ${C})`;
    log(`${slug}: ${O.toLocaleString()} offers`);
    await tx`
      INSERT INTO activities (tenant_id, customer_id, actor_id, kind, title, body, occurred_at)
      SELECT ${T}, c.id, (${tx.array(userIds)}::uuid[])[1 + g % 3],
             (ARRAY['offer_updated','meeting_done','email_sent','approval','call','note'])[1 + g % 6],
             (ARRAY['Προσφορά ενημερώθηκε','Ραντεβού ολοκληρώθηκε','Email στάλθηκε','Έγκριση προσφοράς','Τηλεφωνική επικοινωνία','Σημείωση'])[1 + g % 6],
             'Auto-generated #' || g,
             now() - (g % 540) * interval '1 day' - (g % 1440) * interval '1 minute'
      FROM generate_series(1, ${A}) g
      JOIN tmp_c c ON c.rn = 1 + (g % ${C})`;
    log(`${slug}: ${A.toLocaleString()} activities`);
  });

  // Recompute pre-aggregated counters
  await sql`DELETE FROM tenant_offer_stats WHERE tenant_id = ${T}`;
  await sql`INSERT INTO tenant_offer_stats (tenant_id, status, count, amount)
            SELECT tenant_id, status, count(*), sum(total_amount) FROM offers WHERE tenant_id = ${T} GROUP BY 1, 2`;
  await sql`INSERT INTO tenant_counters (tenant_id, key, value)
            SELECT ${T}, 'customers', count(*) FROM customers WHERE tenant_id = ${T}
            ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`;
  return T;
}

await seedTenant('acme-demo', 'NOVA', 100_000 * scale, true);
for (let i = 1; i <= extraTenants; i++) {
  await seedTenant(`tenant-${i}`, `Tenant ${i}`, 20_000 * scale, false);
}
await sql`SET session_replication_role = origin`.catch(() => {});
const demoTenantIds = (await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ANY(${slugs})`).map((t) => t.id);
await seedDemoBranches(sql, demoTenantIds, log);
await seedDemoBranchAttributes(sql, demoTenantIds, log);
log('ANALYZE ...');
await sql`ANALYZE`;
log(`Done. Login: ${DEMO_EMAIL} (password from SEED_PASSWORD or the default in scripts/seed.ts)`);
await sql.end();
