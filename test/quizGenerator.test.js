const test = require('node:test');
const assert = require('node:assert/strict');
const { referencesMissingCode, createPrompt, parseQuestions, keepValidQuestions, questionsFromGroqError, shouldFallbackToGroq, QUIZ_SCHEMA } = require('../backend/services/quizGenerator');

test('question that refers to missing code', () => {
  assert.equal(referencesMissingCode({ question: 'Analysez ce Dockerfile. Quel est le problème ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Analysez ce .gitlab-ci.yml. Que se passe-t-il ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait le code ci-dessous ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que produit le code suivant ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait la commande suivante ?' }), true);
  assert.equal(referencesMissingCode({ question: 'Que fait cette commande ?' }), true);
});

test('question with the code included', () => {
  assert.equal(referencesMissingCode({ question: "Analysez ce Dockerfile :\n'''FROM node\nCOPY . /app'''" }), false);
  assert.equal(referencesMissingCode({ question: 'Que fait ce code ?\n```js\nlet x = 1;\n```' }), false);
  assert.equal(referencesMissingCode({ question: 'Que fait cette commande : `docker ps -a` ?' }), false);
});

test('question without reference to code ("la / le" + noun is a course question, not a reference to shown code)', () => {
  assert.equal(referencesMissingCode({ question: "Qu'est-ce qu'une image Docker ?" }), false);
  assert.equal(referencesMissingCode({ question: "Quelle est la commande pour lister les conteneurs en cours d'exécution ?" }), false);
  assert.equal(referencesMissingCode({ question: 'Quel est le rôle de la configuration du pipeline dans GitLab CI ?' }), false);
  assert.equal(referencesMissingCode({ question: "Dans quel fichier définit-on les services d'une application ?" }), false);
  assert.equal(referencesMissingCode({ question: "Quelle option ci-dessous n'existe pas ?" }), false);
});

const question = (extra = {}) => ({
  question: 'Quelle instruction définit l\'image de base ?',
  options: ['FROM', 'RUN', 'CMD', 'COPY'],
  correct: 0,
  explanation: 'FROM choisit l\'image de départ.',
  example: '',
  ...extra
});

/** Rules shared by the strict schemas of Claude and Groq. */
function checkStrict(schema, path = 'root') {
  const forbidden = ['minimum', 'maximum', 'multipleOf', 'maxItems', 'minLength', 'maxLength', 'pattern', 'default'];
  for (const keyword of forbidden) assert.equal(keyword in schema, false, `${path}: "${keyword}" is not accepted`);
  if ('minItems' in schema) assert.ok([0, 1].includes(schema.minItems), `${path}: minItems must be 0 or 1`);

  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${path}: closed object`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path}: every field required`);
    for (const [name, child] of Object.entries(schema.properties)) checkStrict(child, `${path}.${name}`);
  }
  if (schema.type === 'array') checkStrict(schema.items, `${path}[]`);
}

test('the schema follows the limits of the strict modes of Claude and Groq', () => {
  assert.equal(QUIZ_SCHEMA.type, 'object', 'the root must be an object');
  checkStrict(QUIZ_SCHEMA);
});

test('the schema describes what the rest of the code expects', () => {
  const item = QUIZ_SCHEMA.properties.questions.items;
  assert.deepEqual(Object.keys(item.properties), ['question', 'options', 'correct', 'explanation', 'example']);
  assert.deepEqual(item.properties.correct.enum, [0, 1, 2, 3]);
});

test('parseQuestions reads the { questions } envelope and returns an array', () => {
  const result = parseQuestions(JSON.stringify({ questions: [question(), question({ correct: 2 })] }));
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 2);
});

test('an invalid question is dropped without losing the others', () => {
  const batch = [
    question(),
    question({ options: ['a', 'b', 'c'] }),
    question({ options: ['a', '', 'c', 'd'] }),
    question({ question: '  ' }),
    question({ explanation: '' }),
    question({ correct: 4 }),
    question({ correct: 1.5 }),
    question({ correct: 3 })
  ];
  const result = parseQuestions(JSON.stringify({ questions: batch }));
  assert.deepEqual(result.map(q => q.correct), [0, 3]);
});

test('a missing example becomes an empty string', () => {
  const { example, ...withoutExample } = question();
  assert.equal(keepValidQuestions([withoutExample])[0].example, '');
});

test('no valid question: error, so the attempt counts as failed', () => {
  assert.throws(() => parseQuestions(JSON.stringify({ questions: [question({ options: [] })] })), /Aucune question valide/);
  assert.throws(() => parseQuestions('pas du json'), /Format JSON invalide/);
  assert.throws(() => parseQuestions(JSON.stringify({ questions: [] })), /Aucune question valide/);
});

test('answer cut by the token limit in the middle of the third question: the whole questions are kept', () => {
  const complete = JSON.stringify({ questions: [question(), question({ correct: 1, question: 'Autre {question} avec "guillemets" et \\ barre' }), question({ correct: 2 })] });
  const cut = complete.slice(0, complete.lastIndexOf('"options"') + 12);
  assert.throws(() => JSON.parse(cut));

  const result = parseQuestions(cut, true);
  assert.equal(result.length, 2);
  assert.equal(result[1].question, 'Autre {question} avec "guillemets" et \\ barre');
});

test('answer cut before the first whole question: clear error', () => {
  assert.throws(() => parseQuestions('{"questions":[{"question":"Que f', true), /aucune question complète/);
});

/** Groq 400 error as thrown by the SDK: error.error is the response body. */
const groqError = (failedGeneration, status = 400) => Object.assign(new Error('400 Generated JSON does not match the expected schema'), {
  status,
  error: { error: { message: 'Generated JSON does not match the expected schema', type: 'invalid_request_error', failed_generation: failedGeneration } }
});

test('Groq refuses its own answer: the valid questions of failed_generation are recovered', () => {
  const incompleteQuestion = { question: 'Il manque des champs', options: ['a', 'b', 'c', 'd'], correct: 0 };
  const failed = JSON.stringify({ questions: [question(), question({ correct: 2 }), incompleteQuestion] });

  const result = questionsFromGroqError(groqError(failed));
  assert.deepEqual(result.map(q => q.correct), [0, 2]);
});

test('Groq: failed_generation cut midway, the whole questions are kept', () => {
  const complete = JSON.stringify({ questions: [question(), question({ correct: 1 }), question({ correct: 2 })] });
  const result = questionsFromGroqError(groqError(complete.slice(0, complete.lastIndexOf('"options"') + 5)));
  assert.equal(result.length, 2);
});

test('Groq: an error without a usable answer is thrown again', () => {
  assert.equal(questionsFromGroqError(groqError(undefined)), null);
  assert.equal(questionsFromGroqError(groqError('')), null);
  assert.equal(questionsFromGroqError(groqError('pas du json')), null);
  assert.equal(questionsFromGroqError(groqError(JSON.stringify({ questions: [{ question: 'x' }] }))), null);
  assert.equal(questionsFromGroqError(groqError(JSON.stringify({ questions: [question()] }), 429)), null, 'only 400s');
  assert.equal(questionsFromGroqError(new Error('réseau')), null);
});

test('Claude: a refusal or a 400 (credit exhausted) falls back to Groq', () => {
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('Claude a refusé de générer ce quiz'), { refusal: true })), true);
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('400 Your credit balance is too low to access the Anthropic API'), { status: 400 })), true);
});

test('Claude: a refused schema does not fall back to Groq and is not retried', () => {
  const error = Object.assign(new Error('400 output_config.format.schema: unsupported keyword'), { status: 400 });
  assert.equal(shouldFallbackToGroq(error), false);
  assert.equal(error.noRetry, true);
});

test('Claude: other errors do not trigger the fallback', () => {
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('500 overloaded'), { status: 500 })), false);
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('401 invalid x-api-key'), { status: 401 })), false);
  assert.equal(shouldFallbackToGroq(new Error('réseau')), false);
});

const assignment = { titre: 'Contrôle Docker', matiere_nom: 'R507', description: 'Tout sauf Prometheus', date: '2026-10-21' };
const range = { min: 8, max: 12 };

test('prompt: the range of questions asked is the one of the call', () => {
  const prompt = createPrompt(assignment, 'DOC', range);
  assert.match(prompt, /entre 8 et 12 questions/);
  assert.doesNotMatch(prompt, /MINIMUM 20|minimum 20/, 'no minimum of 20 per call');
});

test('prompt: the additional prompt only changes the beginning and keeps the rest identical', () => {
  const first = createPrompt(assignment, 'DOC', range);
  const additional = createPrompt(assignment, 'DOC', range, [{ question: 'Q déjà posée A' }, { question: 'Q déjà posée B' }]);

  assert.doesNotMatch(first, /déjà généré/);
  assert.match(additional, /déjà généré 2 questions/);
  assert.match(additional, /1\. Q déjà posée A\n2\. Q déjà posée B/);

  const body = (prompt) => prompt.slice(prompt.indexOf('🎯 OBJECTIF DU QCM'));
  assert.equal(body(additional), body(first));
});

test('prompt: the answer format is only described by the schema', () => {
  const prompt = createPrompt(assignment, 'DOC', range);
  assert.doesNotMatch(prompt, /FORMAT DE RÉPONSE|Format JSON|"correct"|"options"|"explanation"/);
});

test('prompt: "exemple" does not mean code, the "example" field is explained once', () => {
  const prompt = createPrompt(assignment, 'DOC', range);
  assert.doesNotMatch(prompt, /exemples? (de |du )?code|code[^.\n]{0,30}exemple/i);
  assert.equal(prompt.match(/CHAMP "example"|RÈGLES POUR LE CHAMP "example"/g).length, 1);
  assert.match(prompt, /APRÈS que l'étudiant a répondu/);
});

test('schema: the example field says it is only shown after the answer', () => {
  assert.match(QUIZ_SCHEMA.properties.questions.items.properties.example.description, /seulement après qu'il a répondu/);
});
