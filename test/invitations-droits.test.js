const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';
const { JWT_SECRET } = require('../backend/config/jwt');

const USERS = {
  1: { id: 1, username: 'lea', role: 'eleve', classe_id: 4 },
  2: { id: 2, username: 'prof', role: 'admin', classe_id: 4 },
};
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return USERS[params[0]];
  if (method === 'run' && sql.startsWith('INSERT INTO invitations')) return { lastInsertRowid: 1 };
  return undefined;
});

const emailFile = path.join(__dirname, '../backend/services/email.js');
require.cache[emailFile] = { id: emailFile, filename: emailFile, loaded: true, exports: { sendInvitationEmail: async () => {} } };

const router = require('../backend/routes/invitations');
let server;
let url;

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/invitations', router);
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/invitations/create`;
});
after(() => server.close());

const invite = (userId, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId }, JWT_SECRET)}` },
  body: JSON.stringify(body),
});

test('un élève ne peut pas créer d\'invitation, même vers une autre classe', async () => {
  fake.calls.length = 0;
  const res = await invite(1, { email: 'intrus@ex.fr', role: 'eleve', classe_id: 99 });
  assert.equal(res.status, 403);
  assert.ok(!fake.calls.some((c) => c.sql.startsWith('INSERT INTO invitations')));
});

test('un admin invite toujours dans sa propre classe', async () => {
  fake.calls.length = 0;
  const res = await invite(2, { email: 'nouveau@ex.fr', role: 'eleve', classe_id: 99 });
  assert.equal(res.status, 200);
  const insert = fake.calls.find((c) => c.sql.startsWith('INSERT INTO invitations'));
  assert.equal(insert.params[3], 4);
});
