const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.JWT_SECRET = 'test-secret';

const USERS = {
  1: { id: 1, username: 'lea', role: 'eleve', classe_id: 4 },
  2: { id: 2, username: 'tom', role: 'eleve', classe_id: 4 },
  3: { id: 3, username: 'prof', role: 'admin', classe_id: 4 },
  9: { id: 9, username: 'autre', role: 'eleve', classe_id: 7 },
};
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return USERS[params[0]];
  // Le devoir 10 appartient à la classe 4
  if (method === 'get' && sql.includes('FROM devoirs WHERE id')) return params[0] === '10' && params[1] === 4 ? { id: 10 } : undefined;
  // Le commentaire 5 a été écrit par Léa
  if (method === 'get' && sql.includes('WHERE c.id = ?')) {
    return params[0] === '5' ? { id: 5, user_id: 1, contenu: 'Question', username: 'lea', prenom: 'Léa', nom: 'Martin', devoir_titre: 'Exercice 3' } : undefined;
  }
  if (method === 'all' && sql.includes('FROM devoir_commentaires')) {
    return [{ id: 5, contenu: 'Question', user_id: 1, username: 'lea' }, { id: 6, contenu: 'Réponse', user_id: 2, username: 'tom' }];
  }
  if (method === 'run' && sql.startsWith('INSERT')) return { lastInsertRowid: 42 };
  return undefined;
});

// Le notificateur temps réel est testé avec un double du service de diffusion
const sent = [];
const realtimeFile = path.join(__dirname, '../backend/services/realtime.js');
require.cache[realtimeFile] = { id: realtimeFile, filename: realtimeFile, loaded: true, exports: { notifyClasse: (classeId, message) => sent.push({ classeId, message }) } };

const realtimeNotifier = require('../backend/middleware/realtimeNotifier');
const commentaires = require('../backend/routes/commentaires');

let server;
let base;
before(() => {
  const app = express();
  app.use(realtimeNotifier);
  app.use('/api/devoirs/:devoirId/commentaires', commentaires);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/devoirs`;
});
after(() => server.close());

const call = (userId, method, url, body) => fetch(`${base}${url}`, {
  method,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId }, 'test-secret')}` },
  body: body ? JSON.stringify(body) : undefined,
});

describe('commentaires', () => {
  test('liste : chacun peut supprimer les siens, l\'admin tous', async () => {
    const lea = await (await call(1, 'GET', '/10/commentaires')).json();
    assert.deepEqual(lea.map((c) => c.supprimable), [true, false]);
    const prof = await (await call(3, 'GET', '/10/commentaires')).json();
    assert.deepEqual(prof.map((c) => c.supprimable), [true, true]);
  });

  test('devoir d\'une autre classe : 404', async () => {
    assert.equal((await call(9, 'GET', '/10/commentaires')).status, 404);
    assert.equal((await call(9, 'POST', '/10/commentaires', { contenu: 'intrus' })).status, 404);
  });

  test('ajout : texte nettoyé, vide ou trop long refusé', async () => {
    fake.calls.length = 0;
    const res = await call(1, 'POST', '/10/commentaires', { contenu: '  C\'est pour lundi ?  ' });
    assert.equal(res.status, 200);
    const insert = fake.calls.find((c) => c.sql.startsWith('INSERT'));
    assert.deepEqual(insert.params, ['10', 1, 'C\'est pour lundi ?']);

    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: '   ' })).status, 400);
    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: 'a'.repeat(2001) })).status, 400);
  });

  test('suppression : l\'auteur oui, un camarade non, l\'admin oui', async () => {
    assert.equal((await call(2, 'DELETE', '/10/commentaires/5')).status, 403);
    assert.equal((await call(1, 'DELETE', '/10/commentaires/5')).status, 200);
    assert.equal((await call(3, 'DELETE', '/10/commentaires/5')).status, 200);
    assert.equal((await call(1, 'DELETE', '/10/commentaires/999')).status, 404);
  });

  test('suppression : enregistrée dans l\'Historique avec le message et son auteur', async () => {
    fake.calls.length = 0;
    await call(3, 'DELETE', '/10/commentaires/5');
    const log = fake.calls.find((c) => c.sql.startsWith('INSERT INTO devoir_logs'));
    assert.deepEqual(log.params.slice(0, 5), [10, 'delete_commentaire', 3, 'prof', 4]);
    const details = JSON.parse(log.params[5]);
    assert.equal(details.titre, 'Exercice 3');
    assert.equal(details.commentaire.contenu, 'Question');
    assert.deepEqual(details.commentaire.auteur, { username: 'lea', prenom: 'Léa', nom: 'Martin' });
  });

  test('ajout : 10 commentaires par minute et par compte, puis 429', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await call(2, 'POST', '/10/commentaires', { contenu: `Message ${i}` })).status, 200);
    }
    const res = await call(2, 'POST', '/10/commentaires', { contenu: 'Un de trop' });
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /Trop de commentaires/);
    // Le compte d'un camarade n'est pas bloqué
    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: 'Moi aussi' })).status, 200);
  });

  test('temps réel : la classe reçoit « commentaires » pour ce devoir', async () => {
    sent.length = 0;
    await call(1, 'POST', '/10/commentaires', { contenu: 'Merci !' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].classeId, 4);
    assert.equal(sent[0].message.resource, 'commentaires');
    assert.equal(sent[0].message.devoirId, 10);
  });
});
