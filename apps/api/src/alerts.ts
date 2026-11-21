// Alerts for things that silently stop working: the nightly backup and an organisation's ERP sync.
// Each check is a state (fine / not fine). One e-mail when it goes wrong, one when it is fixed, never a stream.
// Backup → the server operator (ALERT_EMAIL, PLATFORM_ADMINS, ALERT_WEBHOOK_URL).
// ERP → the organisation's owners and admins (e-mail + in-app / push notification) and the operator.
import { sql } from './db.js';
import { env } from './env.js';
import { backupStatus } from './monitor.js';

type Message = { subject: string; text: string };
type Target = { emails: string[]; tenantId?: string; userIds?: string[]; url?: string };

/** Records the state of `key`; on a change, queues the message for it. Returns 'started' | 'recovered' | null. */
export async function stateAlert(key: string, bad: boolean, detail: string, target: Target, msg: { bad: Message; ok: Message }) {
  const [cur] = await sql<{ bad: boolean }[]>`SELECT bad FROM alert_state WHERE key = ${key}`;
  if (!cur && !bad) return null;                       // has always been fine
  if (cur && cur.bad === bad) {                        // no change: keep the latest detail only
    if (bad) await sql`UPDATE alert_state SET detail = ${detail.slice(0, 1000)} WHERE key = ${key}`;
    return null;
  }
  // Claimed atomically, so two workers never send the same alert
  const [won] = await sql`
    INSERT INTO alert_state (key, tenant_id, bad, since, detail, notified_at) VALUES (${key}, ${target.tenantId ?? null}, ${bad}, now(), ${detail.slice(0, 1000)}, now())
    ON CONFLICT (key) DO UPDATE SET bad = EXCLUDED.bad, since = now(), detail = EXCLUDED.detail, notified_at = now()
      WHERE alert_state.bad IS DISTINCT FROM EXCLUDED.bad
    RETURNING key`;
  if (!won) return null;
  const m = bad ? msg.bad : msg.ok;
  const text = `${m.text}\n\n${detail}`.trim();
  for (const to of [...new Set(target.emails.map((e) => e.toLowerCase()))]) {
    await sql`INSERT INTO jobs (kind, payload) VALUES ('email', ${sql.json({ to, subject: m.subject.slice(0, 200), text: text.slice(0, 6000) } as never)})`;
  }
  if (target.tenantId && target.userIds?.length) {
    await sql`INSERT INTO jobs (kind, payload) VALUES ('notify', ${sql.json({ tenantId: target.tenantId, userIds: target.userIds, title: m.subject.slice(0, 200), body: detail.slice(0, 300), url: target.url } as never)})`;
  }
  if (env.alert.webhook) {
    await fetch(env.alert.webhook, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ text: `${bad ? '🚨' : '✅'} ${m.subject}\n${detail}`, content: `${bad ? '🚨' : '✅'} ${m.subject}` }),
    }).catch(() => {});
  }
  return bad ? 'started' : 'recovered';
}

const operator = () => [env.alert.email, ...env.platformAdmins].filter(Boolean);
const host = () => env.appUrl.replace(/^https?:\/\//, '');
const fmt = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString('el-GR', { timeZone: 'Europe/Athens', dateStyle: 'short', timeStyle: 'short' }) : '—');

export async function checkBackup() {
  if (!env.backupDir) return null;
  const b = await backupStatus();
  const detail = b.error ? `Κατάσταση: ${b.error}` : `Τελευταίο backup: ${fmt(b.last)} (πριν ${b.age_h} ώρες) · ${b.last_ok ? 'πέτυχε' : 'απέτυχε'}`;
  return stateAlert('backup', !b.ok, detail, { emails: operator() }, {
    bad: { subject: `[SoftifyOS ${host()}] Το backup δεν έγινε`, text: 'Δεν υπάρχει επιτυχημένο backup των τελευταίων 26 ωρών. Δείτε Ρυθμίσεις → Backups ή το deploy/backup.sh στον server.' },
    ok: { subject: `[SoftifyOS ${host()}] Το backup λειτουργεί ξανά`, text: 'Έγινε επιτυχημένο backup.' },
  });
}

/** ERP sync failing for over an hour (no successful run since the error). */
export async function checkErp() {
  const rows = await sql<{ id: string; name: string; enabled: boolean; last_error: string | null; last_ok_at: string | null; interval_min: number }[]>`
    SELECT t.id, t.name, coalesce((t.erp_meta->>'enabled')::boolean, false) AS enabled, t.erp_meta->>'last_error' AS last_error,
           t.erp_meta->>'last_ok_at' AS last_ok_at, coalesce((t.erp_meta->>'interval_min')::int, 2) AS interval_min
    FROM tenants t
    WHERE t.erp_enc IS NOT NULL OR EXISTS (SELECT 1 FROM alert_state a WHERE a.key = 'erp:' || t.id)`;
  let changed = 0;
  for (const t of rows) {
    const key = `erp:${t.id}`;
    if (!t.enabled) { await sql`DELETE FROM alert_state WHERE key = ${key}`; continue; }   // switched off on purpose
    const grace = Math.max(60, t.interval_min * 3) * 60e3;
    const failing = !!t.last_error && (!t.last_ok_at || Date.now() - new Date(t.last_ok_at).getTime() > grace);
    const admins = await sql<{ id: string; email: string }[]>`
      SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      LEFT JOIN roles ro ON ro.tenant_id = m.tenant_id AND ro.key = m.role
      WHERE m.tenant_id = ${t.id} AND (m.role = 'owner' OR 'settings.manage' = ANY(coalesce(ro.permissions, '{}')))`;
    const detail = `Οργανισμός: ${t.name}\nΤελευταίος επιτυχημένος συγχρονισμός: ${fmt(t.last_ok_at)}${t.last_error ? `\nΣφάλμα: ${t.last_error}` : ''}`;
    const r = await stateAlert(key, failing, detail,
      { emails: [...admins.map((a) => a.email), ...operator()], tenantId: t.id, userIds: admins.map((a) => a.id), url: '/settings?s=erp' }, {
        bad: { subject: 'Ο συγχρονισμός με το ERP έχει σταματήσει', text: `Οι ενέργειες δεν συγχρονίζονται με το ERP. Ανοίξτε ${env.appUrl}/el/settings?s=erp για λεπτομέρειες.` },
        ok: { subject: 'Ο συγχρονισμός με το ERP λειτουργεί ξανά', text: 'Ο συγχρονισμός ολοκληρώθηκε επιτυχώς.' },
      });
    if (r) changed++;
  }
  return changed;
}
