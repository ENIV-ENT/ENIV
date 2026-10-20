const test = require('node:test');
const assert = require('node:assert/strict');
const { referencesMissingCode } = require('../backend/services/quizGenerator');

test('question qui renvoie à un code absent', () => {
  assert.equal(referencesMissingCode({ question: 'Analysez ce Dockerfile. Quel est le problème ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Analysez ce .gitlab-ci.yml. Que se passe-t-il ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait le code ci-dessous ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que produit le code suivant ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait la commande suivante ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait cette commande ?' }), true);
});

test('question avec le code inclus', () => {
  assert.equal(referencesMissingCode({ question: "Analysez ce Dockerfile :\n'''FROM node\nCOPY . /app'''" }), false);
  assert.equal(referencesMissingCode({ question: 'Que fait ce code ?\n```js\nlet x = 1;\n```' }), false);
  assert.equal(referencesMissingCode({ question: 'Que fait cette commande : `docker ps -a` ?' }), false);
});

test('question sans référence à du code', () => {
  assert.equal(referencesMissingCode({ question: "Qu'est-ce qu'une image Docker ?" }), false);
  // « la / le » + nom : question de cours, pas une référence à un code montré
  assert.equal(referencesMissingCode({ question: "Quelle est la commande pour lister les conteneurs en cours d'exécution ?" }), false);
  assert.equal(referencesMissingCode({ question: 'Quel est le rôle de la configuration du pipeline dans GitLab CI ?' }), false);
  assert.equal(referencesMissingCode({ question: "Dans quel fichier définit-on les services d'une application ?" }), false);
  assert.equal(referencesMissingCode({ question: "Quelle option ci-dessous n'existe pas ?" }), false);
});
