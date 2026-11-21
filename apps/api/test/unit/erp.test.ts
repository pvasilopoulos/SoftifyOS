// Soft1 value parsing and settings defaults (src/erp.ts). No database: db.ts only connects on the first query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { part, withDefaults } from '../../src/erp.ts';

test('Soft1 lookups "code|name" are split; plain values are a code', () => {
  assert.deepEqual(part('495|Πουλημένου Μαρία'), { code: '495', name: 'Πουλημένου Μαρία' });
  assert.deepEqual(part('7002'), { code: '7002', name: null });
  assert.deepEqual(part(1001), { code: '1001', name: null });
  assert.deepEqual(part('|Μόνο όνομα'), { code: null, name: 'Μόνο όνομα' });
  assert.deepEqual(part('122|'), { code: '122', name: null });
  for (const empty of ['', null, undefined]) assert.deepEqual(part(empty), { code: null, name: null });
});

test('a name may itself contain "|"', () => {
  assert.deepEqual(part('9|Α|Β'), { code: '9', name: 'Α|Β' });
});

test('settings defaults: missing parts are filled, saved choices kept', () => {
  const d = withDefaults(null);
  assert.equal(d.fields.characterization, 'ACTSTATES');
  assert.equal(d.fields.status, 'ACTSTATUS');
  assert.deepEqual(d.series_map, {});
  const m = withDefaults({ fields: { subject: 'MYCOMMENTS' } as never, series_map: { 7001: 'meeting' } } as never);
  assert.equal(m.fields.subject, 'MYCOMMENTS');
  assert.equal(m.fields.remarks, 'REMARKS', 'other fields keep their defaults');
  assert.deepEqual(m.series_map, { 7001: 'meeting' });
  assert.equal(m.lists.status.code, 'CODE');
});
