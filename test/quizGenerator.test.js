const test = require('node:test');
const assert = require('node:assert/strict');
const { referencesMissingCode, createPrompt, parseQuestions, keepValidQuestions, questionsFromGroqError, shouldFallbackToGroq, QUIZ_SCHEMA } = require('../backend/services/quizGenerator');

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

// --- Sortie contrainte -------------------------------------------------------

const question = (extra = {}) => ({
  question: 'Quelle instruction définit l\'image de base ?',
  options: ['FROM', 'RUN', 'CMD', 'COPY'],
  correct: 0,
  explanation: 'FROM choisit l\'image de départ.',
  example: '',
  ...extra
});

// Règles communes aux schémas stricts de Claude et de Groq
function checkStrict(schema, path = 'racine') {
  const interdits = ['minimum', 'maximum', 'multipleOf', 'maxItems', 'minLength', 'maxLength', 'pattern', 'default'];
  for (const mot of interdits) assert.equal(mot in schema, false, `${path} : « ${mot} » n'est pas accepté`);
  if ('minItems' in schema) assert.ok([0, 1].includes(schema.minItems), `${path} : minItems doit valoir 0 ou 1`);

  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${path} : objet fermé`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} : tous les champs obligatoires`);
    for (const [nom, sous] of Object.entries(schema.properties)) checkStrict(sous, `${path}.${nom}`);
  }
  if (schema.type === 'array') checkStrict(schema.items, `${path}[]`);
}

test('le schéma respecte les limites des modes stricts de Claude et de Groq', () => {
  assert.equal(QUIZ_SCHEMA.type, 'object', 'la racine doit être un objet');
  checkStrict(QUIZ_SCHEMA);
});

test('le schéma décrit ce que le reste du code attend', () => {
  const item = QUIZ_SCHEMA.properties.questions.items;
  assert.deepEqual(Object.keys(item.properties), ['question', 'options', 'correct', 'explanation', 'example']);
  assert.deepEqual(item.properties.correct.enum, [0, 1, 2, 3]);
});

test('parseQuestions lit l\'enveloppe { questions } et rend un tableau', () => {
  const result = parseQuestions(JSON.stringify({ questions: [question(), question({ correct: 2 })] }));
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 2);
});

test('une question invalide est écartée sans perdre les autres', () => {
  const lot = [
    question(),
    question({ options: ['a', 'b', 'c'] }),
    question({ options: ['a', '', 'c', 'd'] }),
    question({ question: '  ' }),
    question({ explanation: '' }),
    question({ correct: 4 }),
    question({ correct: 1.5 }),
    question({ correct: 3 })
  ];
  const result = parseQuestions(JSON.stringify({ questions: lot }));
  assert.deepEqual(result.map(q => q.correct), [0, 3]);
});

test('l\'exemple manquant devient une chaîne vide', () => {
  const { example, ...sansExemple } = question();
  assert.equal(keepValidQuestions([sansExemple])[0].example, '');
});

test('aucune question valide : erreur, pour que la tentative compte comme échouée', () => {
  assert.throws(() => parseQuestions(JSON.stringify({ questions: [question({ options: [] })] })), /Aucune question valide/);
  assert.throws(() => parseQuestions('pas du json'), /Format JSON invalide/);
  assert.throws(() => parseQuestions(JSON.stringify({ questions: [] })), /Aucune question valide/);
});

test('réponse coupée par la limite de tokens : les questions entières sont gardées', () => {
  const complet = JSON.stringify({ questions: [question(), question({ correct: 1, question: 'Autre {question} avec "guillemets" et \\ barre' }), question({ correct: 2 })] });
  // Coupé au milieu de la troisième question
  const coupe = complet.slice(0, complet.lastIndexOf('"options"') + 12);
  assert.throws(() => JSON.parse(coupe));

  const result = parseQuestions(coupe, true);
  assert.equal(result.length, 2);
  assert.equal(result[1].question, 'Autre {question} avec "guillemets" et \\ barre');
});

test('réponse coupée avant la première question entière : erreur claire', () => {
  assert.throws(() => parseQuestions('{"questions":[{"question":"Que f', true), /aucune question complète/);
});

// --- Erreurs des fournisseurs --------------------------------------------------

// Erreur 400 de Groq telle que la lève le SDK : error.error est le corps de la réponse
const erreurGroq = (failedGeneration, status = 400) => Object.assign(new Error('400 Generated JSON does not match the expected schema'), {
  status,
  error: { error: { message: 'Generated JSON does not match the expected schema', type: 'invalid_request_error', failed_generation: failedGeneration } }
});

test('Groq refuse sa propre réponse : les questions valides de failed_generation sont récupérées', () => {
  const question34 = { question: 'Il manque des champs', options: ['a', 'b', 'c', 'd'], correct: 0 };
  const failed = JSON.stringify({ questions: [question(), question({ correct: 2 }), question34] });

  const result = questionsFromGroqError(erreurGroq(failed));
  assert.deepEqual(result.map(q => q.correct), [0, 2]);
});

test('Groq : failed_generation coupé en route, les questions entières sont gardées', () => {
  const complet = JSON.stringify({ questions: [question(), question({ correct: 1 }), question({ correct: 2 })] });
  const result = questionsFromGroqError(erreurGroq(complet.slice(0, complet.lastIndexOf('"options"') + 5)));
  assert.equal(result.length, 2);
});

test('Groq : une erreur sans réponse exploitable est relancée', () => {
  assert.equal(questionsFromGroqError(erreurGroq(undefined)), null);
  assert.equal(questionsFromGroqError(erreurGroq('')), null);
  assert.equal(questionsFromGroqError(erreurGroq('pas du json')), null);
  assert.equal(questionsFromGroqError(erreurGroq(JSON.stringify({ questions: [{ question: 'x' }] }))), null);
  assert.equal(questionsFromGroqError(erreurGroq(JSON.stringify({ questions: [question()] }), 429)), null, 'seulement les 400');
  assert.equal(questionsFromGroqError(new Error('réseau')), null);
});

test('Claude : un refus ou un 400 (crédit épuisé) passe sur Groq', () => {
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('Claude a refusé de générer ce quiz'), { refusal: true })), true);
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('400 Your credit balance is too low to access the Anthropic API'), { status: 400 })), true);
});

test('Claude : un schéma refusé ne passe pas sur Groq et n\'est pas réessayé', () => {
  const erreur = Object.assign(new Error('400 output_config.format.schema: unsupported keyword'), { status: 400 });
  assert.equal(shouldFallbackToGroq(erreur), false);
  assert.equal(erreur.noRetry, true);
});

test('Claude : les autres erreurs ne déclenchent pas le repli', () => {
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('500 overloaded'), { status: 500 })), false);
  assert.equal(shouldFallbackToGroq(Object.assign(new Error('401 invalid x-api-key'), { status: 401 })), false);
  assert.equal(shouldFallbackToGroq(new Error('réseau')), false);
});

// --- Prompt ------------------------------------------------------------------

const devoir = { titre: 'Contrôle Docker', matiere_nom: 'R507', description: 'Tout sauf Prometheus', date: '2026-10-21' };
const range = { min: 8, max: 12 };

test('prompt : la fourchette de questions demandée est celle de l\'appel', () => {
  const prompt = createPrompt(devoir, 'DOC', range);
  assert.match(prompt, /entre 8 et 12 questions/);
  assert.doesNotMatch(prompt, /MINIMUM 20|minimum 20/, 'pas de minimum de 20 par appel');
});

test('prompt : le complément ne change que le début et garde le reste identique', () => {
  const premier = createPrompt(devoir, 'DOC', range);
  const complement = createPrompt(devoir, 'DOC', range, [{ question: 'Q déjà posée A' }, { question: 'Q déjà posée B' }]);

  assert.doesNotMatch(premier, /déjà généré/);
  assert.match(complement, /déjà généré 2 questions/);
  assert.match(complement, /1\. Q déjà posée A\n2\. Q déjà posée B/);

  const corps = (prompt) => prompt.slice(prompt.indexOf('🎯 OBJECTIF DU QCM'));
  assert.equal(corps(complement), corps(premier));
});

test('prompt : le format de la réponse n\'est décrit que par le schéma', () => {
  const prompt = createPrompt(devoir, 'DOC', range);
  assert.doesNotMatch(prompt, /FORMAT DE RÉPONSE|Format JSON|"correct"|"options"|"explanation"/);
});

test('prompt : « exemple » ne désigne pas du code, le champ « example » est expliqué une fois', () => {
  const prompt = createPrompt(devoir, 'DOC', range);
  assert.doesNotMatch(prompt, /exemples? (de |du )?code|code[^.\n]{0,30}exemple/i);
  assert.equal(prompt.match(/CHAMP "example"|RÈGLES POUR LE CHAMP "example"/g).length, 1);
  assert.match(prompt, /APRÈS que l'étudiant a répondu/);
});

test('schéma : le champ example précise qu\'il n\'est affiché qu\'après la réponse', () => {
  assert.match(QUIZ_SCHEMA.properties.questions.items.properties.example.description, /seulement après qu'il a répondu/);
});
