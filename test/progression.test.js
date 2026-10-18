const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculerProgression, ajouterJours } = require('../backend/services/progression');

const AUJ = '2026-10-18';
const d = (id, jour, fait, matiere = 'Maths') => ({ id, titre: `Devoir ${id}`, date: new Date(`${jour}T00:00:00Z`), fait, matiere_nom: matiere, matiere_couleur: '#123456' });

test('ajouterJours traverse mois et années', () => {
  assert.equal(ajouterJours('2026-10-31', 1), '2026-11-01');
  assert.equal(ajouterJours('2026-01-01', -1), '2025-12-31');
});

test('taux sur 30 jours : seuls les devoirs passés comptent', () => {
  const p = calculerProgression([
    d(1, '2026-10-10', 1), d(2, '2026-10-12', 1), d(3, '2026-10-15', 0), d(4, '2026-10-17', 1),
    d(5, AUJ, 0),               // aujourd'hui : pas encore en retard
    d(6, '2026-08-01', 0),      // trop ancien
  ], AUJ);
  assert.deepEqual(p.trente_jours, { total: 4, faits: 3, taux: 75 });
});

test('aucun devoir passé : taux null plutôt que 0 %', () => {
  assert.equal(calculerProgression([d(1, '2026-10-20', 0)], AUJ).trente_jours.taux, null);
});

test('série : devoirs faits d\'affilée en partant du plus récent', () => {
  const p = calculerProgression([d(1, '2026-10-10', 0), d(2, '2026-10-12', 1), d(3, '2026-10-15', 1), d(4, '2026-10-17', 1)], AUJ);
  assert.equal(p.serie, 3);
  assert.equal(calculerProgression([d(1, '2026-10-17', 0)], AUJ).serie, 0);
});

test('à rattraper : passés non faits, du plus récent au plus ancien', () => {
  const p = calculerProgression([d(1, '2026-10-10', 0, 'Philo'), d(2, '2026-10-16', 0), d(3, '2026-10-17', 1)], AUJ);
  assert.deepEqual(p.a_rattraper.map((x) => [x.id, x.date]), [[2, '2026-10-16'], [1, '2026-10-10']]);
});

test('7 prochains jours : un jour par case, faits et restants', () => {
  const p = calculerProgression([d(1, '2026-10-19', 1), d(2, '2026-10-19', 0), d(3, '2026-10-24', 0), d(4, '2026-10-25', 0)], AUJ);
  assert.equal(p.semaine.length, 7);
  assert.equal(p.semaine[0].date, AUJ);
  assert.deepEqual(p.semaine[1], { date: '2026-10-19', total: 2, restants: 1 });
  assert.equal(p.semaine[6].date, '2026-10-24');
  assert.deepEqual(p.a_venir, { total: 3, restants: 2 }); // le 25 est hors des 7 jours
});

test('par matière, triées par nom', () => {
  const p = calculerProgression([d(1, '2026-10-10', 1, 'SVT'), d(2, '2026-10-11', 0, 'Anglais'), d(3, '2026-10-12', 1, 'Anglais')], AUJ);
  assert.deepEqual(p.par_matiere.map((m) => [m.nom, m.faits, m.total]), [['Anglais', 1, 2], ['SVT', 1, 1]]);
});

test('statut « fait » venant de MySQL en 0/1 ou en chaîne', () => {
  const p = calculerProgression([d(1, '2026-10-10', '1'), d(2, '2026-10-11', '0')], AUJ);
  assert.equal(p.trente_jours.faits, 1);
});
