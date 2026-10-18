const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./helpers/fakeDb');

const fake = installFakeDb();
const { toDateString, snapshotDevoir, diffSnapshots, logDevoirAction } = require('../backend/services/devoirLogger');

test('dates normalisées en YYYY-MM-DD, qu\'elles viennent de MySQL ou d\'un formulaire', () => {
  assert.equal(toDateString('2026-10-20'), '2026-10-20');
  assert.equal(toDateString('2026-10-20T00:00:00.000Z'), '2026-10-20');
  assert.equal(toDateString(''), null);
  assert.equal(toDateString(null), null);
});

test('aucune fausse modification entre une ligne SQL et le même formulaire', () => {
  const ligne = snapshotDevoir({ titre: 'TP', description: '', matiere_id: 3, date: '2026-10-20T00:00:00.000Z' });
  const formulaire = snapshotDevoir({ titre: 'TP', description: null, matiere_id: '3', date: '2026-10-20' });
  assert.deepEqual(diffSnapshots(ligne, formulaire), []);
});

test('modifications détectées champ par champ, avec le nom des matières', () => {
  const avant = snapshotDevoir({ titre: 'TP', matiere_id: 1, matiere_nom: 'Physique', date: '2026-10-20' });
  const apres = snapshotDevoir({ titre: 'TP noté', matiere_id: 2, matiere_nom: 'Chimie', date: '2026-10-20' });
  const changes = diffSnapshots(avant, apres);
  assert.deepEqual(changes.map((c) => c.field), ['titre', 'matiere_id']);
  assert.equal(changes[1].before_label, 'Physique');
  assert.equal(changes[1].after_label, 'Chimie');
});

test('une erreur d\'écriture du journal ne fait jamais échouer l\'action', async (t) => {
  fake.setHandler(() => { throw new Error('base indisponible'); });
  t.mock.method(console, 'error', () => {});
  const req = { user: { id: 1, username: 'lea', role: 'eleve', classe_id: 1 } };
  await assert.doesNotReject(() => logDevoirAction(req, { devoirId: 1, action: 'create' }));
});
