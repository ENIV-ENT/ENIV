const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';
const { JWT_SECRET } = require('../backend/config/jwt');

const ADMIN = { id: 2, username: 'prof', role: 'admin', classe_id: 4 };
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return params[0] === ADMIN.id ? ADMIN : undefined;
  return undefined;
});

const emailFile = path.join(__dirname, '../backend/services/email.js');
require.cache[emailFile] = { id: emailFile, filename: emailFile, loaded: true, exports: { sendInvitationEmail: async () => {} } };

const router = require('../backend/routes/invitations');
let server;
let url;

before(() => {
  const app = express();
  app.use('/api/invitations', router);
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/invitations`;
});
after(() => server.close());

test('the invitation list never selects the registration token', async () => {
  fake.calls.length = 0;
  const res = await fetch(`${url}/list`, { headers: { authorization: `Bearer ${jwt.sign({ userId: ADMIN.id }, JWT_SECRET)}` } });
  assert.equal(res.status, 200);
  const query = fake.calls.find((c) => c.method === 'all' && c.sql.includes('FROM invitations'));
  assert.ok(query);
  assert.doesNotMatch(query.sql, /i\.\*|token/);
});
