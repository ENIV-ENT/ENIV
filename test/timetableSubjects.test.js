const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchSubjects } = require('../backend/services/timetableSubjects');

const SUBJECTS = [
  { id: 1, nom: 'R505 - Programmation avancée', couleur: '#fcff6e' },
  { id: 2, nom: 'R514 - Anglais', couleur: '#f673ce' },
  { id: 3, nom: 'R51 - Autre module', couleur: '#000000' },
  { id: 4, nom: 'SAÉ', couleur: '#eeeeee' },
  { id: 5, nom: 'Programmation', couleur: '#111111' },
  { id: 6, nom: 'R512 - Modélisations mathématiques', couleur: 'red; background: url(x)' },
];

const subjectOf = (title, description = '') => matchSubjects([{ titre: title, description }], SUBJECTS)[0].matiere?.id ?? null;

test('by code: in the ADE description or the title, glued to a prefix; R51 is not found in R514 or R510', () => {
  assert.equal(subjectOf('[ALT] TD - Langue G01', 'TD-BUT3 INFO\nTBFAR514 - Anglais\nGD - Informatique'), 2);
  assert.equal(subjectOf('CM - R505 Prog. avancée'), 1);
  assert.equal(subjectOf('CM', 'TBFTR510 - Nouveaux paradigmes'), null);
});

test('by name in the title, ignoring accents and case; the longest name wins', () => {
  assert.equal(subjectOf('[ALT] TD - Anglais G01'), 2);
  assert.equal(subjectOf('TD - PROGRAMMATION AVANCEE G02'), 1);
  assert.equal(subjectOf('Soutenances SAE BUT3A'), 4);
  assert.equal(subjectOf('TD - Programmation avancée'), 1);
  assert.equal(subjectOf('TD - Programmation web'), 5);
});

test('the name is not searched in the description, nor inside a word', () => {
  assert.equal(subjectOf('TD - Portfolio', 'Parcours Anglais renforcé'), null);
  assert.equal(subjectOf('Anglaise'), null);
  assert.equal(subjectOf('Entreprise'), null);
});

test('a color that is not hexadecimal sets the subject aside', () => {
  assert.equal(subjectOf('TD - Modélisations mathématiques'), null);
});

test('does not change the lessons received', () => {
  const lessons = [{ titre: 'TD - Anglais', description: '' }];
  const [result] = matchSubjects(lessons, SUBJECTS);
  assert.deepEqual(result.matiere, { id: 2, nom: 'R514 - Anglais', couleur: '#f673ce' });
  assert.equal('matiere' in lessons[0], false);
});
