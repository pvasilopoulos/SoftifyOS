// Demo CRM activities "as in the ERP" (code, series, requester, handler, characterisation, status, start/end,
// remarks) for customers of an organisation, so the customer tab "Ενέργειες" and the AI summary have data.
//   npm run db:seed:actions -- [--tenant <slug>] [--customers 300]
// Additive and marked (custom.demo = true): re-running adds more; remove them with --remove.
import postgres from 'postgres';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { tenant: { type: 'string' }, customers: { type: 'string', default: '300' }, remove: { type: 'boolean', default: false } } });
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

// Licensing of music in businesses (shops, cafés, hotels) — like the ERP screenshots
const SUBJECTS: Record<string, string[]> = {
  offer: [
    'Β1Β. ΧΡΗΣΙΜΗ (ΑΠΟΚΛΕΙΣΤΙΚΗ ΧΡΗΣΗ ΡΑΔΙΟΦΩΝΟΥ ή/και TV) // {amount}', 'Β1Α. ΜΟΥΣΙΚΗ ΥΠΟΚΡΟΥΣΗ ΚΑΤΑΣΤΗΜΑΤΟΣ // {amount}',
    'Γ2. ΖΩΝΤΑΝΗ ΜΟΥΣΙΚΗ (ΕΚΔΗΛΩΣΕΙΣ) // {amount}', 'Α3. ΑΔΕΙΑ ΔΗΜΟΣΙΑΣ ΕΚΤΕΛΕΣΗΣ ΕΤΟΥΣ {year} // {amount}',
  ],
  meeting: ['Ενημέρωση χρήστη', 'Συνάντηση με ιδιοκτήτη για άδεια {year}', 'Παρουσίαση τιμολογιακής πολιτικής', 'Διευκρινίσεις για χρεώσεις χώρων'],
  visit: ['Επίσκεψη ελέγχου καταστήματος', 'Αυτοψία χώρων και εξοπλισμού', 'Επίσκεψη για υπογραφή σύμβασης', 'Επανέλεγχος μετά από καταγγελία'],
  call: ['Τηλεφωνική ενημέρωση για ανανέωση', 'Υπενθύμιση εξόφλησης', 'Follow up προσφοράς', 'Επιβεβαίωση ραντεβού'],
  email: ['Αποστολή σύμβασης για υπογραφή', 'Αποστολή αντιγράφου τιμολογίου', 'Απάντηση σε ερώτημα πελάτη'],
  task: ['Έλεγχος στοιχείων ΓΕΜΗ', 'Ενημέρωση αρχείου πελάτη', 'Προετοιμασία πρότασης ανανέωσης'],
  note: ['Εσωτερική σημείωση', 'Σημείωση από επίσκεψη'],
};
const REMARKS = [
  'ΠΡΟΚΕΙΤΑΙ ΓΙΑ ΚΑΦΕΝΕΙΟ ΣΤΟ {city}, ΕΙΧΕ ΔΥΟ ΧΩΡΟΥΣ, Ο ΕΝΑΣ ΕΧΕΙ ΗΧΕΙΟ Ο ΑΛΛΟΣ ΕΧΕΙ ΕΝΑ ΦΟΡΗΤΟ ΚΑΙ ΜΙΑ ΤΗΛΕΟΡΑΣΗ ΠΟΥ ΕΔΕΙΧΝΕ ΑΓΩΝΑ.',
  'Ο ιδιοκτήτης ζήτησε έκπτωση λόγω εποχικής λειτουργίας (Μάιος–Οκτώβριος). Του εξηγήσαμε την κλίμακα χρεώσεων και θα επανέλθει μέσα στην εβδομάδα.',
  'Κατάστημα ένδυσης με μουσική υπόκρουση σε όλο το ωράριο. Δύο ηχεία οροφής, περίπου 80 τ.μ. Συμφώνησε με την προσφορά, θέλει να πληρώσει σε 3 δόσεις.',
  'Δεν ήταν ο υπεύθυνος. Αφήσαμε έντυπο ενημέρωσης και το τηλέφωνό μας. Να ξανακαλέσουμε μετά τις 18:00.',
  'Υπάρχει τηλεόραση στο μπαρ και ραδιόφωνο στην κουζίνα. Ισχυρίζεται ότι η τηλεόραση είναι μόνο για ειδήσεις. Χρειάζεται δεύτερη επίσκεψη για επιβεβαίωση.',
  'Ξενοδοχείο 24 δωματίων με τηλεοράσεις στα δωμάτια και μουσική στη ρεσεψιόν. Ζήτησε ενιαία προσφορά για όλους τους χώρους.',
  'Πλήρωσε την προηγούμενη χρονιά με καθυστέρηση 2 μηνών. Προτείνεται υπενθύμιση έγκαιρα και πάγια εντολή.',
  'Νέα επιχείρηση (άνοιξε τον {month}). Ενημερώθηκε για τις υποχρεώσεις του και ζήτησε προσφορά με email.',
  'Η σύμβαση υπογράφηκε. Το πρωτότυπο θα σταλεί με courier. Ενημερώθηκε το λογιστήριο για την τιμολόγηση.',
  'Διαφωνεί με τα τετραγωνικά που υπολογίσαμε (δηλώνει 45 τ.μ. αντί 70). Ζητήθηκε κάτοψη από τον λογιστή του.',
  'Καφετέρια με DJ τα Σάββατα. Η ζωντανή μουσική χρειάζεται ξεχωριστή άδεια. Του στάλθηκε ενημερωτικό.',
  'Ο πελάτης είναι ικανοποιημένος. Ζήτησε να ενημερωθεί για τις νέες τιμές του {year} πριν από τη λήξη.',
  '',
];
const CITIES = ['ΔΙΔΥΜΟΤΕΙΧΟ', 'ΑΛΕΞΑΝΔΡΟΥΠΟΛΗ', 'ΚΟΜΟΤΗΝΗ', 'ΞΑΝΘΗ', 'ΚΑΒΑΛΑ', 'ΔΡΑΜΑ', 'ΣΕΡΡΕΣ', 'ΘΕΣΣΑΛΟΝΙΚΗ', 'ΛΑΡΙΣΑ', 'ΒΟΛΟ', 'ΠΑΤΡΑ', 'ΑΘΗΝΑ'];
const MONTHS = ['Ιανουάριο', 'Φεβρουάριο', 'Μάρτιο', 'Απρίλιο', 'Μάιο', 'Ιούνιο', 'Ιούλιο', 'Αύγουστο', 'Σεπτέμβριο', 'Οκτώβριο', 'Νοέμβριο', 'Δεκέμβριο'];

// type key → series prefix, series code (as Soft1 would number them)
const SERIES: Record<string, [string, string]> = { offer: ['OFF', '7001'], meeting: ['ΣΥΝ', '7002'], visit: ['ΕΠΙ', '7003'], call: ['ΤΗΛ', '7004'], email: ['EML', '7005'], task: ['ΕΡΓ', '7006'], note: ['ΣΗΜ', '7007'] };

let seed = 20261121;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

async function main() {
  const [t] = a.tenant
    ? await sql`SELECT id, slug FROM tenants WHERE slug = ${a.tenant}`
    : await sql`SELECT t.id, t.slug FROM tenants t JOIN memberships m ON m.tenant_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'demo@softifyos.local' ORDER BY m.created_at LIMIT 1`;
  if (!t) throw new Error('organisation not found (--tenant <slug>)');
  const T = t.id as string;
  if (a.remove) {
    const r = await sql.begin(async (tx) => { await tx`SELECT set_config('app.erp_sync', '1', true)`; return tx`DELETE FROM crm_activities WHERE tenant_id = ${T} AND custom->>'demo' = 'true'`; });
    console.log(`removed ${r.count} demo activities from ${t.slug}`);
    return;
  }
  // The ERP lists the activities refer to
  const chars: [string, string, boolean, string | null][] = [
    ['101', 'Ενημέρωση πελάτη', true, null], ['102', 'Follow up', true, null], ['103', 'Χωρίς ενημέρωση', true, null], ['104', 'Χωρίς απόκριση', true, null],
    ['106', 'Follow up (Ολοκληρώθηκε)', true, 'done'], ['120', 'Ακύρωση', true, 'cancelled'], ['121', 'Προς εκτέλεση', true, 'planned'], ['122', 'Εκτελεσμένη', true, 'done'],
    ['124', 'Προς έναρξη', true, 'planned'], ['203', 'Σε εξέλιξη', true, 'in_progress'], ['801', 'Απαντημένο', true, null], ['802', 'Αναπάντητο', true, null],
    ['806', 'Σε αναμονή', true, 'planned'], ['900', 'Εσωτερική Σημείωση', true, null],
  ];
  const statuses: [string, string, string][] = [['1', 'Προς έναρξη', 'planned'], ['2', 'Σε εξέλιξη', 'in_progress'], ['3', 'Ολοκληρώθηκε', 'done'], ['4', 'Ακυρώθηκε', 'cancelled'],
    ['5', 'Αδιάφορο', 'cancelled'], ['6', 'Σε αναμονή', 'planned'], ['7', 'Σε αναβολή', 'planned'], ['8', 'Προς επιστροφή', 'planned']];
  for (const [code, name, active, maps] of chars) {
    await sql`INSERT INTO crm_erp_values (tenant_id, kind, code, name, active, maps_to, sort) VALUES (${T}, 'characterization', ${code}, ${name}, ${active}, ${maps}, ${Number(code)}) ON CONFLICT DO NOTHING`;
  }
  for (const [i, [code, name, maps]] of statuses.entries()) {
    await sql`INSERT INTO crm_erp_values (tenant_id, kind, code, name, active, maps_to, sort) VALUES (${T}, 'status', ${code}, ${name}, true, ${maps}, ${i + 1}) ON CONFLICT DO NOTHING`;
  }
  const typeKeys = new Set((await sql`SELECT key FROM crm_activity_types WHERE tenant_id = ${T}`).map((x) => x.key as string));
  // "Αποστολή Προσφοράς" as its own type, like the ERP series
  if (!typeKeys.has('offer')) {
    await sql`INSERT INTO crm_activity_types (tenant_id, key, name, icon, color, default_duration, sort) VALUES (${T}, 'offer', 'Αποστολή Προσφοράς', 'file-text', 'warning', 0, 0) ON CONFLICT DO NOTHING`;
    typeKeys.add('offer');
  }
  const kinds = Object.keys(SUBJECTS).filter((k) => typeKeys.has(k));
  const users = (await sql`SELECT user_id FROM memberships WHERE tenant_id = ${T}`).map((x) => x.user_id as string);
  const n = Math.max(1, Math.min(5000, Number(a.customers)));
  // Customers with ERP ids first (they are the ones synced), then the rest
  const customers = await sql`SELECT c.id, c.name, (SELECT array_agg(b.id) FROM branches b WHERE b.customer_id = c.id) AS branches
                              FROM customers c WHERE c.tenant_id = ${T} AND c.archived_at IS NULL
                              ORDER BY (c.external_id IS NULL), c.created_at LIMIT ${n}`;
  const [{ max }] = await sql`SELECT coalesce(max(substring(erp_code from '[0-9]+$')::int), 8000) AS max FROM crm_activities WHERE tenant_id = ${T} AND erp_code ~ '[0-9]+$'`;
  let num = Number(max) + 1;
  const rows: Record<string, unknown>[] = [];
  const now = Date.now();
  for (const c of customers) {
    const count = 3 + Math.floor(rnd() * 10);
    const city = pick(CITIES);
    for (let i = 0; i < count; i++) {
      const type = pick(kinds);
      const past = rnd() < 0.82;
      const start = new Date(now + (past ? -Math.floor(rnd() * 540) : Math.floor(rnd() * 60) + 1) * 864e5);
      start.setHours(8 + Math.floor(rnd() * 10), pick([0, 15, 30, 45]), 0, 0);
      const long = type === 'offer' && rnd() < 0.6;
      const ends = new Date(start.getTime() + (long ? (5 + Math.floor(rnd() * 20)) * 864e5 : (15 + Math.floor(rnd() * 8) * 15) * 60_000));
      // Past ones mostly done; future ones open
      let char: string | null; let erpStatus: string | null = null;
      if (past) {
        const r = rnd();
        char = r < 0.55 ? '122' : r < 0.65 ? '106' : r < 0.72 ? '120' : r < 0.8 ? '801' : r < 0.86 ? '802' : r < 0.92 ? '101' : '104';
        if (rnd() < 0.3) erpStatus = char === '120' ? '4' : ['801', '802', '101', '104'].includes(char) ? '3' : '3';
        if (rnd() < 0.06) { char = '806'; erpStatus = '6'; }
      } else {
        char = pick(['121', '124', '806', '203', '102']);
        if (rnd() < 0.35) erpStatus = char === '203' ? '2' : pick(['1', '6', '7', '8']);
      }
      if (type === 'note') { char = '900'; erpStatus = null; }
      const year = start.getFullYear();
      const subject = pick(SUBJECTS[type]).replace('{amount}', (80 + Math.floor(rnd() * 900)).toFixed(1)).replace('{year}', String(year + (past ? 0 : 1)));
      const remark = pick(REMARKS).replace('{city}', city).replace('{month}', pick(MONTHS)).replace('{year}', String(year + 1));
      const [prefix, series] = SERIES[type];
      const owner = pick(users), requester = rnd() < 0.7 ? owner : pick(users);
      rows.push({
        tenant_id: T, type, subject, body: remark || null, priority: rnd() < 0.15 ? 1 : rnd() < 0.85 ? 2 : 3,
        due_at: start, ends_at: ends, duration_min: Math.min(10080, Math.round((ends.getTime() - start.getTime()) / 60_000)),
        owner_id: owner, created_by: owner, requested_by: requester, customer_id: c.id,
        branch_id: c.branches?.length ? pick(c.branches as string[]) : null,
        erp_code: `${prefix}${String(num++).padStart(7, '0')}`, characterization: char, erp_status: erpStatus,
        custom: sql.json({ demo: true, series } as never),
      });
    }
  }
  // As the sync would write them: no "pending" marks, no echo to the ERP
  let total = 0;
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.erp_sync', '1', true)`;
    for (let i = 0; i < rows.length; i += 500) {
      const r = await tx`INSERT INTO crm_activities ${tx(rows.slice(i, i + 500) as never)}`;
      total += r.count;
    }
    // Done ones: when they were done (the status trigger set completed_at = now)
    await tx`UPDATE crm_activities SET completed_at = coalesce(ends_at, due_at) WHERE tenant_id = ${T} AND custom->>'demo' = 'true' AND status = 'done'`;
  });
  console.log(`demo activities: ${total} for ${customers.length} customers of ${t.slug}`);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
