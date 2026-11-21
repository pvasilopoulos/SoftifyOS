// End-to-end: ERP (Soft1) two-way sync, AI features with cost control, customers at risk, alerts.
// Runs against a temporary database and fakes (see harness.ts): safe to run any time, costs nothing.
//   npm run test:e2e          (needs the local PostgreSQL running: npm run dev:db)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, OPS_EMAIL, OWNER_EMAIL, PASSWORD, sleep, startEnv, waitFor, type Env } from './harness.ts';

let E: Env;
const c = () => new Client(E.api);
let me: Client;

before(async () => {
  E = await startEnv();
  me = c();
  await me.ok('POST', '/auth/login', { email: OWNER_EMAIL, password: PASSWORD });
});
after(async () => { await E?.stop(); });

/** ERP jobs are queued and run by the worker: wait until nothing is queued or running. */
async function erpIdle(label: string) {
  return waitFor(`ERP idle (${label})`, async () => {
    const s = await me.ok('GET', '/settings/erp');
    return !s.queued.length && !s.meta.running ? s : null;
  }, 60_000, 500);
}
const mockState = async () => (await fetch(`${E.mock}/__state`)).json() as Promise<{ actions: Record<string, string>[] }>;
const activities = async () => (await me.ok('GET', `/crm/activities?scope=all&status=any&customer_id=${E.customerId}&limit=50`)).items as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Activity rows written as if they came from the ERP (not sent back to it). */
async function insertActivities(rows: { subject: string; status: string; days: number; completed?: boolean }[]) {
  await E.sql.begin(async (tx) => {
    await tx`SELECT set_config('app.erp_sync', '1', true)`;
    for (const r of rows) {
      const at = new Date(Date.now() + r.days * 864e5);
      await tx`INSERT INTO crm_activities (tenant_id, type, subject, status, due_at, completed_at, customer_id, owner_id, created_by)
               VALUES (${E.tenantId}, 'call', ${r.subject}, ${r.status}, ${at}, ${r.completed ? at : null}, ${E.customerId}, ${E.ownerId}, ${E.ownerId})`;
    }
  });
}
const emailed = (to: string, subject: RegExp) => new RegExp(`\\[email not configured\\] to=${to.replace('.', '\\.')} subject="${subject.source}`).test(E.worker.out);

// ====================================================================== ERP
describe('ERP: Soft1 two-way sync', () => {
  test('connection: right and wrong credentials', async () => {
    await me.ok('PUT', '/settings/erp/connection', { url: E.mock, username: 'demo', password: 'demo', app_id: '1001' });
    const good = await me.ok('POST', '/settings/erp/test', {});
    assert.ok(good.ok, `test failed: ${good.error}`);
    assert.match(good.company, /Δοκιμαστική/);
    const bad = await me.ok('POST', '/settings/erp/test', { password: 'wrong' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /λάθος/i);
  });

  test('settings, field discovery and dry run', async () => {
    const fields = await me.ok('GET', '/settings/erp/fields');
    assert.ok(fields.fields.some((f: { name: string }) => f.name === 'ACTSTATES'));
    await me.ok('POST', '/settings/erp/values/preset');
    const s0 = await me.ok('GET', '/settings/erp');
    const settings = {
      ...s0.meta, enabled: true, direction: 'both', conflict: 'newest', interval_min: 60, window_days: 365,
      fields: { ...s0.defaults.fields }, series_map: { 7001: 'meeting', 7002: 'call' }, default_series: '7002', default_type: 'meeting',
      users_map: { P01: E.ownerId, P02: E.otherId }, priority_map: { 1: 1, 2: 2, 3: 3 },
      lists: { ...s0.meta.lists, characterization: { object: 'ACTCHAR', code: 'CODE', name: 'NAME', active: 'ISACTIVE' } },
    };
    for (const k of ['last_pull_at', 'last_push_at', 'last_reconcile_at', 'last_ok_at', 'last_error', 'connected', 'provider', 'running', 'seen']) delete settings[k];
    await me.ok('PUT', '/settings/erp/settings', settings);
    const sample = await me.ok('GET', '/settings/erp/sample');
    assert.equal(sample.mapped.customer_id, E.customerId, 'Soft1 customer 1001 is matched by external id');
    const pv = await me.ok('POST', '/settings/erp/preview');
    assert.equal(pv.preview.length, 3);
    assert.equal(pv.preview.filter((p: { action: string }) => p.action !== 'skip').length, 2, 'the record of an unknown customer is skipped');
  });

  test('full import maps series, characterisation, status, people and priority', async () => {
    await me.ok('POST', '/settings/erp/sync', { what: 'full' });
    const st = await erpIdle('full');
    const acts = (await activities()).filter((a) => a.external_id);
    assert.equal(acts.length, 2);
    const off = acts.find((a) => a.erp_code?.startsWith('OFF'))!;
    const syn = acts.find((a) => a.erp_code === 'ΣΥΝ0002925')!;
    assert.equal(off.characterization, '122'); assert.equal(off.status, 'done'); assert.equal(off.type, 'meeting');
    assert.equal(off.requested_by, E.ownerId); assert.equal(off.branch_id, E.branchId);
    assert.ok(new Date(off.ends_at) > new Date(off.due_at), 'start and end');
    assert.equal(syn.erp_status, '1'); assert.equal(syn.status, 'planned'); assert.equal(syn.owner_id, E.otherId); assert.equal(syn.priority, 1);
    assert.ok(st.log.some((l: { message: string }) => /δεν βρέθηκε/.test(l.message)), 'missing customer is logged');
    assert.equal(st.values.find((v: { kind: string; code: string }) => v.kind === 'characterization' && v.code === '123')?.active, false);
  });

  test('a local change is pushed; a new activity is created in Soft1; a deletion follows', async () => {
    const syn = (await activities()).find((a) => a.erp_code === 'ΣΥΝ0002925')!;
    const detail = await me.ok('GET', `/crm/activities/${syn.id}`);
    await me.ok('PUT', `/crm/activities/${syn.id}`, { ...detail, subject: 'Αλλαγή από SoftifyOS', erp_status: '3', recurrence: null });
    const pending = await me.ok('GET', `/crm/activities/${syn.id}`);
    assert.equal(pending.status, 'done', 'ERP status 3 → done');
    assert.equal(pending.erp_state, 'pending');
    await waitFor('pushed to Soft1', async () => {
      const remote = (await mockState()).actions.find((a) => a.SOACTION === syn.external_id);
      return remote?.COMMENTS === 'Αλλαγή από SoftifyOS' && remote.ACTSTATUS === '3';
    });
    await waitFor('marked synced', async () => (await me.ok('GET', `/crm/activities/${syn.id}`)).erp_state === 'synced');

    const created = await me.ok('POST', '/crm/activities', { type: 'call', subject: 'Νέα κλήση από SoftifyOS', customer_id: E.customerId, characterization: '121', requested_by: E.ownerId, due_at: new Date(Date.now() + 864e5).toISOString() });
    const made = await waitFor('created in Soft1', async () => { const a = await me.ok('GET', `/crm/activities/${created.id}`); return a.external_id ? a : null; });
    assert.match(made.erp_code ?? '', /^ΣΥΝ/);
    const remote = (await mockState()).actions.find((a) => a.SOACTION === made.external_id)!;
    assert.ok(String(remote.SERIES).startsWith('7002') && String(remote.ACTSTATES).startsWith('121') && String(remote.ORDEREDBY).startsWith('P01'));

    await me.ok('DELETE', `/crm/activities/${created.id}?series=one`);
    await waitFor('deleted in Soft1', async () => !(await mockState()).actions.some((a) => a.SOACTION === made.external_id));
  });

  test('a change in Soft1 is pulled', async () => {
    const off = (await activities()).find((a) => a.erp_code?.startsWith('OFF'))!;
    await fetch(`${E.mock}/__touch/${off.external_id}`, { method: 'POST', body: JSON.stringify({ REMARKS: 'Αλλαγή από το Soft1', ACTSTATES: '121|Προς εκτέλεση' }) });
    await me.ok('POST', '/settings/erp/sync', { what: 'pull' });
    await erpIdle('pull');
    const a = await me.ok('GET', `/crm/activities/${off.id}`);
    assert.equal(a.body, 'Αλλαγή από το Soft1');
    assert.equal(a.status, 'planned', 'characterisation 121 → planned');
  });

  test('ERP failing for over an hour e-mails the admins once, and again when fixed', async () => {
    const { checkErp } = await import('../../src/alerts.ts');
    E.stopMock();
    await me.ok('POST', '/settings/erp/sync', { what: 'pull' });
    const s = await erpIdle('failing pull');
    assert.ok(s.meta.last_error, 'the failed run is recorded');
    await E.sql`UPDATE tenants SET erp_meta = erp_meta || '{"last_ok_at": "2020-01-01T00:00:00Z"}'::jsonb WHERE id = ${E.tenantId}`;
    assert.equal(await checkErp(), 1);
    assert.equal(await checkErp(), 0, 'no second e-mail while it stays broken');
    const [st] = await E.sql`SELECT bad FROM alert_state WHERE key = ${`erp:${E.tenantId}`}`;
    assert.equal(st.bad, true);
    await waitFor('alert e-mail to the owner', async () => emailed(OWNER_EMAIL, /Ο συγχρονισμός με το ERP έχει σταματήσει/));
    assert.ok(emailed(OPS_EMAIL, /Ο συγχρονισμός με το ERP έχει σταματήσει/), 'and to the operator');
    const [n] = await E.sql`SELECT count(*)::int AS n FROM notifications WHERE tenant_id = ${E.tenantId} AND user_id = ${E.ownerId} AND title LIKE '%ERP%'`;
    await waitFor('in-app notification', async () => (await E.sql`SELECT 1 FROM notifications WHERE user_id = ${E.ownerId} AND title LIKE '%ERP%'`).length > 0);
    assert.ok(n.n <= 1);

    await E.restartMock();
    await me.ok('POST', '/settings/erp/sync', { what: 'pull' });
    const ok = await erpIdle('pull after fix');
    assert.equal(ok.meta.last_error ?? null, null);
    assert.equal(await checkErp(), 1);
    await waitFor('recovery e-mail', async () => emailed(OWNER_EMAIL, /Ο συγχρονισμός με το ERP λειτουργεί ξανά/));
  });
});

// ====================================================================== AI
describe('AI: next best action, summary, metering and limits', () => {
  const calls = () => E.ai.calls.length;
  test('AI is switched on for the organisation', async () => {
    await me.ok('PUT', '/settings/ai', {
      enabled: true, consent: true, monthly_budget_usd: 50,
      features: { copilot: true, voice: true, summary: true, actions_summary: true, next_action: true, reports: true, offer_draft: true, import: true },
    });
    const st = await me.ok('GET', '/ai/status');
    assert.equal(st.configured, true);
    assert.equal(st.features.next_action, true);
  });

  test('activities summary goes through the (fake) API and is metered', async () => {
    const before = calls();
    const r = await me.ok('POST', `/ai/customers/${E.customerId}/actions-summary`, { locale: 'el' });
    assert.equal(calls(), before + 1, 'exactly one call, to the fake server');
    assert.match(r.text, /Δοκιμαστική σύνοψη/);
    const u = await me.ok('GET', '/settings/ai/usage');
    const row = u.recent.find((x: { feature: string }) => x.feature === 'actions_summary');
    assert.equal(row.status, 'ok');
    assert.ok(Number(row.cost_usd ?? row.usd) > 0, 'cost recorded from the token counts');
  });

  test('next action: generated once, saved, cleaned, and reused until the data changes', async () => {
    assert.equal((await me.ok('GET', `/ai/customers/${E.customerId}/next-action`)).insight, null);
    const before = calls();
    const r = await me.ok('POST', `/ai/customers/${E.customerId}/next-action`, { locale: 'el' });
    assert.equal(calls(), before + 1);
    assert.ok(E.ai.calls.at(-1)!.structured, 'structured output was requested');
    assert.equal(r.insight.actions.length, 2);
    assert.equal(r.insight.actions[0].type, 'call');
    assert.equal(r.insight.actions[1].type, 'task', 'unknown activity type replaced by a real one');
    assert.equal(r.insight.actions[1].due_in_days, 60, 'clamped');
    assert.equal(r.insight.actions[1].priority, 2, 'invalid priority → normal');

    const cached = await me.ok('GET', `/ai/customers/${E.customerId}/next-action`);
    assert.equal(cached.stale, false);
    assert.equal(cached.insight.situation, E.ai.nextAction.situation);
    assert.equal(calls(), before + 1, 'reading the saved suggestion costs nothing');

    await me.ok('POST', '/crm/activities', { type: 'call', subject: 'Κλήση μετά την πρόταση', customer_id: E.customerId, due_at: new Date(Date.now() + 2 * 864e5).toISOString() });
    assert.equal((await me.ok('GET', `/ai/customers/${E.customerId}/next-action`)).stale, true, 'new activity → out of date');
  });

  test('an API error is recorded, not charged', async () => {
    E.ai.failNext = 400;
    const r = await me.call('POST', `/ai/customers/${E.customerId}/next-action`, { locale: 'el' });
    assert.equal(r.status, 502);
    const u = await me.ok('GET', '/settings/ai/usage');
    assert.ok(u.recent.some((x: { feature: string; status: string }) => x.feature === 'next_action' && x.status === 'error'));
  });

  test('a per-user limit blocks before calling the API', async () => {
    const before = calls();
    await me.ok('PUT', '/settings/ai/limits', { warn_pct: 80, rate_per_min: 20, roles: {}, users: { [E.ownerId]: { monthly: 0.0001, daily: null } }, features: {} });
    const r = await me.call('POST', `/ai/customers/${E.customerId}/next-action`, { locale: 'el' });
    assert.equal((r.body as { error: string }).error, 'user_budget_exceeded');
    assert.equal(r.status, 409);
    assert.equal(calls(), before, 'no call reached the API');
    await me.ok('PUT', '/settings/ai/limits', { warn_pct: 80, rate_per_min: 20, roles: {}, users: {}, features: {} });
  });
});

// ====================================================================== customers at risk + backup alert
describe('Customers at risk', () => {
  test('silence and overdue work put a customer on the list, with reasons', async () => {
    await insertActivities([
      { subject: 'Παλιά επίσκεψη', status: 'done', days: -100, completed: true },
      { subject: 'Ξεχασμένη κλήση', status: 'planned', days: -20 },
    ]);
    // Only this customer's history counts; delete newer ones made by earlier tests
    await E.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.erp_sync', '1', true)`;
      await tx`DELETE FROM crm_activities WHERE customer_id = ${E.customerId} AND subject NOT IN ('Παλιά επίσκεψη', 'Ξεχασμένη κλήση')`;
    });
    await me.ok('POST', '/customers/at-risk/refresh');
    const list = await waitFor('customer listed', async () => {
      const r = await me.ok('GET', '/customers/at-risk');
      return r.items.some((x: { id: string }) => x.id === E.customerId) ? r : null;
    }, 30_000);
    const row = list.items.find((x: { id: string }) => x.id === E.customerId);
    assert.deepEqual(row.reasons.map((x: { code: string }) => x.code), ['no_contact', 'overdue']);
    assert.equal(row.score, 35 + 8);
    assert.equal(row.level, 'medium');
    assert.equal(list.counts.medium, 1);
    const one = await me.ok('GET', `/customers/${E.customerId}/risk`);
    assert.equal(one.risk.score, 43);
    const mine = await me.ok('GET', '/customers/at-risk?mine=1');
    assert.equal(mine.items.length, 1, 'account manager filter');
  });

  test('a sales user cannot trigger a full recompute', async () => {
    const sales = c();
    await sales.ok('POST', '/auth/login', { email: 'sales@e2e.test', password: PASSWORD });
    assert.equal((await sales.call('POST', '/customers/at-risk/refresh')).status, 403);
    assert.equal((await sales.ok('GET', '/customers/at-risk')).items.length, 1, 'but can see the list');
  });
});

describe('Backup alert', () => {
  test('a backup older than 26 hours e-mails the operator once, and again when fixed', async () => {
    const { checkBackup } = await import('../../src/alerts.ts');
    assert.equal(await checkBackup(), null, 'fresh backup: nothing to say');
    writeFileSync(join(E.backupDir, 'last.json'), JSON.stringify({ finished_at: new Date(Date.now() - 3 * 864e5).toISOString(), ok: true }));
    assert.equal(await checkBackup(), 'started');
    assert.equal(await checkBackup(), null);
    await waitFor('backup alert e-mail', async () => emailed(OPS_EMAIL, /\[SoftifyOS [^\]]+\] Το backup δεν έγινε/));
    writeFileSync(join(E.backupDir, 'last.json'), JSON.stringify({ finished_at: new Date().toISOString(), ok: true }));
    assert.equal(await checkBackup(), 'recovered');
    await sleep(100);
  });
});
