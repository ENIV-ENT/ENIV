const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';
const { JWT_SECRET } = require('../backend/config/jwt');

const USERS = { 1: { id: 1, username: 'lea', role: 'eleve', classe_id: 4 } };
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return USERS[params[0]];
  return undefined;
});

const router = require('../backend/routes/assignments');
let server;
let url;

before(() => {
  const app = express();
  app.use('/api/devoirs', router);
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/devoirs`;
});
after(() => server.close());

const update = (body) => fetch(`${url}/1`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: 1 }, JWT_SECRET)}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});

for (const [scenario, body] of [
  ['without a title', { matiere_id: 3 }],
  ['without a subject', { titre: 'Exercice 3' }],
  ['without a body', undefined],
]) {
  test(`updating an assignment ${scenario}: 400 without an assignment query`, async () => {
    fake.calls.length = 0;
    const res = await update(body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Titre et matière requis');
    assert.ok(!fake.calls.some((c) => c.sql.includes('devoirs') || c.sql.includes('matieres')));
  });
}
