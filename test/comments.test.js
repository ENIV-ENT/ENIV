const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.JWT_SECRET = 'test-secret';

const USERS = {
  1: { id: 1, username: 'lea', prenom: 'Léa', nom: 'Martin', role: 'eleve', classe_id: 4 },
  2: { id: 2, username: 'tom', role: 'eleve', classe_id: 4 },
  3: { id: 3, username: 'prof', role: 'admin', classe_id: 4 },
  9: { id: 9, username: 'autre', role: 'eleve', classe_id: 7 },
};

/** Assignment 10 belongs to class 4; comment 5 was written by Léa. */
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return USERS[params[0]];
  if (method === 'get' && sql.includes('FROM devoirs WHERE id')) return params[0] === '10' && params[1] === 4 ? { id: 10, titre: 'Exercice 3' } : undefined;
  if (method === 'get' && sql.includes('WHERE c.id = ?')) {
    return params[0] === '5' ? { id: 5, user_id: 1, contenu: 'Question', username: 'lea', prenom: 'Léa', nom: 'Martin', devoir_titre: 'Exercice 3' } : undefined;
  }
  if (method === 'all' && sql.includes('FROM devoir_commentaires')) {
    return [{ id: 5, contenu: 'Question', user_id: 1, username: 'lea' }, { id: 6, contenu: 'Réponse', user_id: 2, username: 'tom' }];
  }
  if (method === 'run' && sql.startsWith('INSERT')) return { lastInsertRowid: 42 };
  if (method === 'get' && sql.includes('COUNT(*)')) return { n: 3 };
  return undefined;
});

const sent = [];
const realtimeFile = path.join(__dirname, '../backend/services/realtime.js');
require.cache[realtimeFile] = { id: realtimeFile, filename: realtimeFile, loaded: true, exports: { notifyClass: (classId, message) => sent.push({ classId, message }) } };

const pushes = [];
const pushFile = path.join(__dirname, '../backend/services/push.js');
require.cache[pushFile] = { id: pushFile, filename: pushFile, loaded: true, exports: {
  notifyCommentInBackground: (classId, assignmentId, payload, excludeUserId) => pushes.push({ classId, assignmentId, payload, excludeUserId }),
} };

const realtimeNotifier = require('../backend/middleware/realtimeNotifier');
const comments = require('../backend/routes/comments');

let server;
let base;
before(() => {
  const app = express();
  app.use(realtimeNotifier);
  app.use('/api/devoirs/:assignmentId/commentaires', comments);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/devoirs`;
});
after(() => server.close());

const call = (userId, method, url, body) => fetch(`${base}${url}`, {
  method,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId }, 'test-secret')}` },
  body: body ? JSON.stringify(body) : undefined,
});

describe('comments', () => {
  test('list: everyone can delete their own, the admin all of them', async () => {
    const lea = await (await call(1, 'GET', '/10/commentaires')).json();
    assert.deepEqual(lea.map((c) => c.supprimable), [true, false]);
    const prof = await (await call(3, 'GET', '/10/commentaires')).json();
    assert.deepEqual(prof.map((c) => c.supprimable), [true, true]);
  });

  test('assignment of another class: 404', async () => {
    assert.equal((await call(9, 'GET', '/10/commentaires')).status, 404);
    assert.equal((await call(9, 'POST', '/10/commentaires', { contenu: 'intrus' })).status, 404);
  });

  test('non-integer ids: 404, without an assignment query', async () => {
    fake.calls.length = 0;
    assert.equal((await call(1, 'POST', '/10abc/commentaires', { contenu: 'Bonjour' })).status, 404);
    assert.equal((await call(3, 'DELETE', '/10/commentaires/5abc')).status, 404);
    assert.equal(fake.calls.some((c) => c.sql.includes('FROM devoirs')), false);
  });

  test('add: text trimmed, empty or too long refused', async () => {
    fake.calls.length = 0;
    const res = await call(1, 'POST', '/10/commentaires', { contenu: '  C\'est pour lundi ?  ' });
    assert.equal(res.status, 200);
    const insert = fake.calls.find((c) => c.sql.startsWith('INSERT'));
    assert.deepEqual(insert.params, ['10', 1, 'C\'est pour lundi ?']);

    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: '   ' })).status, 400);
    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: 'a'.repeat(2001) })).status, 400);
  });

  test('delete: the author yes, a classmate no, the admin yes', async () => {
    assert.equal((await call(2, 'DELETE', '/10/commentaires/5')).status, 403);
    assert.equal((await call(1, 'DELETE', '/10/commentaires/5')).status, 200);
    assert.equal((await call(3, 'DELETE', '/10/commentaires/5')).status, 200);
    assert.equal((await call(1, 'DELETE', '/10/commentaires/999')).status, 404);
  });

  test('delete: recorded in the history with the message and its author', async () => {
    fake.calls.length = 0;
    await call(3, 'DELETE', '/10/commentaires/5');
    const log = fake.calls.find((c) => c.sql.startsWith('INSERT INTO devoir_logs'));
    assert.deepEqual(log.params.slice(0, 5), [10, 'delete_commentaire', 3, 'prof', 4]);
    const details = JSON.parse(log.params[5]);
    assert.equal(details.titre, 'Exercice 3');
    assert.equal(details.commentaire.contenu, 'Question');
    assert.deepEqual(details.commentaire.auteur, { username: 'lea', prenom: 'Léa', nom: 'Martin' });
  });

  test('add: 10 comments per minute and per account, then 429; a classmate is not blocked', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await call(2, 'POST', '/10/commentaires', { contenu: `Message ${i}` })).status, 200);
    }
    const res = await call(2, 'POST', '/10/commentaires', { contenu: 'Un de trop' });
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /Trop de commentaires/);
    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: 'Moi aussi' })).status, 200);
  });

  test('push: the class is told according to the preferences, except the author; without a name, the username is used', async () => {
    pushes.length = 0;
    assert.equal((await call(1, 'POST', '/10/commentaires', { contenu: 'C\'est pour lundi ?' })).status, 200);
    assert.equal(pushes.length, 1);
    assert.deepEqual(pushes[0], {
      classId: 4,
      assignmentId: 10,
      payload: {
        title: '💬 Exercice 3',
        body: 'Léa Martin : C\'est pour lundi ?',
        url: '/dashboard/?devoir=10&commentaires=1',
        tag: 'commentaire-10',
      },
      excludeUserId: 1,
    });

    pushes.length = 0;
    await call(3, 'POST', '/10/commentaires', { contenu: 'Oui' });
    assert.equal(pushes[0].payload.body, 'prof : Oui');
  });

  test('push: nothing is sent for a refused comment', async () => {
    pushes.length = 0;
    await call(1, 'POST', '/10/commentaires', { contenu: '   ' });
    await call(1, 'POST', '/10/commentaires', { contenu: 'a'.repeat(2001) });
    await call(9, 'POST', '/10/commentaires', { contenu: 'intrus' });
    assert.equal(pushes.length, 0);
  });

  test('realtime: the class gets "commentaires" for this assignment, with the comment count', async () => {
    sent.length = 0;
    await call(1, 'POST', '/10/commentaires', { contenu: 'Merci !' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].classId, 4);
    assert.equal(sent[0].message.resource, 'commentaires');
    assert.equal(sent[0].message.devoirId, 10);
    assert.equal(sent[0].message.nbCommentaires, 3);
  });
});
