// Rules of the customer risk score (src/risk.ts). Pure function: no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RISK_MIN_SCORE, scoreRisk, type RiskFacts } from '../../src/risk.ts';

const now = new Date('2026-11-22T10:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5);
const base: RiskFacts = {
  customer_created: daysAgo(400), last_contact: daysAgo(5), upcoming: 0, overdue: 0, cancelled_90: 0, done_90: 2, done_prev_90: 2,
  offers_expired: 0, offers_expiring: 0, offers_rejected_180: 0, open_amount: 0,
};

test('a customer in regular contact has no risk', () => {
  const r = scoreRisk(base, now);
  assert.equal(r.score, 0);
  assert.equal(r.level, 'low');
  assert.deepEqual(r.reasons, []);
});

test('silence grows the score in steps (30 / 60 / 90 days)', () => {
  assert.equal(scoreRisk({ ...base, last_contact: daysAgo(29) }, now).score, 0);
  assert.equal(scoreRisk({ ...base, last_contact: daysAgo(30) }, now).score, 10);
  assert.equal(scoreRisk({ ...base, last_contact: daysAgo(65) }, now).score, 25);
  const r = scoreRisk({ ...base, last_contact: daysAgo(120) }, now);
  assert.equal(r.score, 35);
  assert.deepEqual(r.reasons[0], { code: 'no_contact', days: 120 });
});

test('a planned activity halves the silence penalty', () => {
  assert.equal(scoreRisk({ ...base, last_contact: daysAgo(120), upcoming: 1 }, now).score, 18);
});

test('never contacted counts only after the first month', () => {
  assert.equal(scoreRisk({ ...base, last_contact: null, customer_created: daysAgo(10) }, now).score, 0);
  const r = scoreRisk({ ...base, last_contact: null, customer_created: daysAgo(45) }, now);
  assert.equal(r.score, 20);
  assert.equal(r.reasons[0].code, 'never_contacted');
  assert.ok(r.score < RISK_MIN_SCORE, 'on its own it is not enough to be listed');
});

test('offers: expired unanswered, expiring, rejected (capped)', () => {
  const r = scoreRisk({ ...base, offers_expired: 5, offers_expiring: 1, open_amount: 1200, offers_rejected_180: 1 }, now);
  assert.equal(r.score, 30 + 10 + 10);
  assert.deepEqual(r.reasons.map((x) => x.code), ['offers_expired', 'offers_expiring', 'offers_rejected']);
  assert.deepEqual(r.reasons[1], { code: 'offers_expiring', n: 1, amount: 1200 });
});

test('overdue activities are capped at three', () => {
  assert.equal(scoreRisk({ ...base, overdue: 10 }, now).score, 24);
});

test('activity drop: at least 3 before and a third or less now', () => {
  assert.equal(scoreRisk({ ...base, done_prev_90: 6, done_90: 2 }, now).score, 15);
  assert.equal(scoreRisk({ ...base, done_prev_90: 6, done_90: 3 }, now).score, 0);
  assert.equal(scoreRisk({ ...base, done_prev_90: 2, done_90: 0 }, now).score, 0);
});

test('levels and the 100 ceiling; reasons ordered by weight', () => {
  const r = scoreRisk({ ...base, last_contact: daysAgo(200), overdue: 3, offers_expired: 2, offers_rejected_180: 2, cancelled_90: 4, done_prev_90: 9, done_90: 0 }, now);
  assert.equal(r.score, 100);
  assert.equal(r.level, 'high');
  assert.equal(r.reasons[0].code, 'no_contact');
  assert.equal(scoreRisk({ ...base, last_contact: daysAgo(100) }, now).level, 'medium');
});
