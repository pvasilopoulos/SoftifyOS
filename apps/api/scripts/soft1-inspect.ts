// Read-only: how one Soft1 activity maps with the suggested Soft1 fields (nothing is saved).
//   npx tsx --env-file=../../.env scripts/soft1-inspect.ts <key>
import { sql } from '../src/db.js';
import { fromErp, loadErp, SOFT1_FIELDS } from '../src/erp.js';
import { Soft1 } from '../src/softone.js';

const key = process.argv[2];
const [t] = await sql`SELECT id FROM tenants WHERE erp_enc IS NOT NULL LIMIT 1`;
const l = await loadErp(t.id as string);
l.meta.fields = { ...SOFT1_FIELDS };
const rec = await new Soft1(l.conn!).get(l.meta.object, l.meta.table, key);
const m = await fromErp(sql, t.id as string, l, rec!, { learn: false });
console.log(JSON.stringify({ erp_code: m.erp_code, type: m.type, due_at: m.due_at, ends_at: m.ends_at, customer_found: !!m.customer_id, customer_erp_id: m.customer_label,
  characterization: m.characterization, erp_status: m.erp_status, priority: m.priority, subject_len: m.subject.length, remarks_len: m.body?.length ?? 0,
  problems: m.problems, seen_kinds: Object.fromEntries(Object.entries(m.seen).map(([k, v]) => [k, Object.keys(v)])) }, null, 1));
await sql.end();
