const test = require('node:test');
const assert = require('node:assert/strict');
const { referencesMissingCode } = require('../backend/services/quizGenerator');

test('question qui renvoie à un code absent', () => {
  assert.equal(referencesMissingCode({ question: 'Analysez ce Dockerfile. Quel est le problème ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Analysez ce .gitlab-ci.yml. Que se passe-t-il ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait le code ci-dessous ?' }), true);
});

test('question avec le code inclus', () => {
  assert.equal(referencesMissingCode({ question: "Analysez ce Dockerfile :\n'''FROM node\nCOPY . /app'''" }), false);
  assert.equal(referencesMissingCode({ question: 'Que fait ce code ?\n```js\nlet x = 1;\n```' }), false);
});

test('question sans référence à du code', () => {
  assert.equal(referencesMissingCode({ question: "Qu'est-ce qu'une image Docker ?" }), false);
});
