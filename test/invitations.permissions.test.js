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
  url = `http://127.0.0.1:${server.address().port}/api/invitations`;
});
after(() => server.close());

const bearer = (userId) => `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;

const invite = (userId, body) => fetch(`${url}/create`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: bearer(userId) },
  body: JSON.stringify(body),
});

test('a student cannot create an invitation, even to another class', async () => {
  fake.calls.length = 0;
  const res = await invite(1, { email: 'intrus@ex.fr', role: 'eleve', classe_id: 99 });
  assert.equal(res.status, 403);
  assert.ok(!fake.calls.some((c) => c.sql.startsWith('INSERT INTO invitations')));
});

test('an admin always invites into their own class', async () => {
  fake.calls.length = 0;
  const res = await invite(2, { email: 'nouveau@ex.fr', role: 'eleve', classe_id: 99 });
  assert.equal(res.status, 200);
  const insert = fake.calls.find((c) => c.sql.startsWith('INSERT INTO invitations'));
  assert.equal(insert.params[3], 4);
});

test('a student cannot list the invitations', async () => {
  const res = await fetch(`${url}/list`, { headers: { authorization: bearer(1) } });
  assert.equal(res.status, 403);
});

test('a request without a body (req.body undefined in Express 5) returns 400, not 500', async () => {
  const withoutBody = (path, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers });
  assert.equal((await withoutBody('/create', { authorization: bearer(2) })).status, 400);
  assert.equal((await withoutBody('/check-username')).status, 400);
  assert.equal((await withoutBody('/complete')).status, 400);
});
