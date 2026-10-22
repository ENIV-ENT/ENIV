const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchSubjects } = require('../backend/services/timetableSubjects');

const MATIERES = [
  { id: 1, nom: 'R505 - Programmation avancée', couleur: '#fcff6e' },
  { id: 2, nom: 'R514 - Anglais', couleur: '#f673ce' },
  { id: 3, nom: 'R51 - Autre module', couleur: '#000000' },
  { id: 4, nom: 'SAÉ', couleur: '#eeeeee' },
  { id: 5, nom: 'Programmation', couleur: '#111111' },
  { id: 6, nom: 'R512 - Modélisations mathématiques', couleur: 'red; background: url(x)' },
];

const matiere = (titre, description = '') => matchSubjects([{ titre, description }], MATIERES)[0].matiere?.id ?? null;

test('par code : dans la description ADE ou le titre, collé à un préfixe', () => {
  assert.equal(matiere('[ALT] TD - Langue G01', 'TD-BUT3 INFO\nTBFAR514 - Anglais\nGD - Informatique'), 2);
  assert.equal(matiere('CM - R505 Prog. avancée'), 1);
  // R51 ne doit pas être reconnu dans R514 ou R510
  assert.equal(matiere('CM', 'TBFTR510 - Nouveaux paradigmes'), null);
});

test('par nom dans le titre, sans tenir compte des accents ni de la casse', () => {
  assert.equal(matiere('[ALT] TD - Anglais G01'), 2);
  assert.equal(matiere('TD - PROGRAMMATION AVANCEE G02'), 1);
  assert.equal(matiere('Soutenances SAE BUT3A'), 4);
  // Le nom le plus long l'emporte sur « Programmation »
  assert.equal(matiere('TD - Programmation avancée'), 1);
  assert.equal(matiere('TD - Programmation web'), 5);
});

test('le nom n\'est pas cherché dans la description, ni au milieu d\'un mot', () => {
  assert.equal(matiere('TD - Portfolio', 'Parcours Anglais renforcé'), null);
  assert.equal(matiere('Anglaise'), null);
  assert.equal(matiere('Entreprise'), null);
});

test('une couleur qui n\'est pas hexadécimale écarte la matière', () => {
  assert.equal(matiere('TD - Modélisations mathématiques'), null);
});

test('ne modifie pas les cours reçus', () => {
  const cours = [{ titre: 'TD - Anglais', description: '' }];
  const [resultat] = matchSubjects(cours, MATIERES);
  assert.deepEqual(resultat.matiere, { id: 2, nom: 'R514 - Anglais', couleur: '#f673ce' });
  assert.equal('matiere' in cours[0], false);
});
