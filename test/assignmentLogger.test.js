const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./helpers/fakeDb');

const fake = installFakeDb();
const { toDateString, snapshotAssignment, diffSnapshots, logAssignmentAction } = require('../backend/services/assignmentLogger');

test('dates normalized to YYYY-MM-DD, whether they come from MySQL or a form', () => {
  assert.equal(toDateString('2026-10-20'), '2026-10-20');
  assert.equal(toDateString('2026-10-20T00:00:00.000Z'), '2026-10-20');
  assert.equal(toDateString(''), null);
  assert.equal(toDateString(null), null);
});

test('mysql2 Date object (UTC midnight): same day whatever the server time zone', () => {
  const tz = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Europe/Paris', 'America/New_York', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      assert.equal(toDateString(new Date('2026-10-20T00:00:00Z')), '2026-10-20', zone);
    }
    assert.equal(toDateString(new Date('invalide')), null);
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

test('no false change between an SQL row and the same form', () => {
  const row = snapshotAssignment({ titre: 'TP', description: '', matiere_id: 3, date: '2026-10-20T00:00:00.000Z' });
  const form = snapshotAssignment({ titre: 'TP', description: null, matiere_id: '3', date: '2026-10-20' });
  assert.deepEqual(diffSnapshots(row, form), []);
});

test('changes detected field by field, with the subject names', () => {
  const before = snapshotAssignment({ titre: 'TP', matiere_id: 1, matiere_nom: 'Physique', date: '2026-10-20' });
  const after = snapshotAssignment({ titre: 'TP noté', matiere_id: 2, matiere_nom: 'Chimie', date: '2026-10-20' });
  const changes = diffSnapshots(before, after);
  assert.deepEqual(changes.map((c) => c.field), ['titre', 'matiere_id']);
  assert.equal(changes[1].before_label, 'Physique');
  assert.equal(changes[1].after_label, 'Chimie');
});

test('a log write error never makes the action fail', async (t) => {
  fake.setHandler(() => { throw new Error('database down'); });
  t.mock.method(console, 'error', () => {});
  const req = { user: { id: 1, username: 'lea', role: 'eleve', classe_id: 1 } };
  await assert.doesNotReject(() => logAssignmentAction(req, { assignmentId: 1, action: 'create' }));
  assert.ok(fake.calls.some((c) => c.method === 'run' && c.sql.startsWith('INSERT INTO devoir_logs')), 'INSERT attempted');
});
