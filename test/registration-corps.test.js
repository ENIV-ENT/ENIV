const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';
const fake = installFakeDb();

const emailFile = path.join(__dirname, '../backend/services/email.js');
require.cache[emailFile] = {
  id: emailFile, filename: emailFile, loaded: true,
  exports: { sendJoinRequestEmail: async () => {}, sendEtablissementRequestEmail: async () => {} },
};

const router = require('../backend/routes/registration');
let server;
let url;

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/registration', router);
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/registration`;
});
after(() => server.close());

// Sans corps JSON, Express 5 laisse req.body à undefined
const sansCorps = (route) => fetch(`${url}${route}`, { method: 'POST' });

test('inscription sans corps : 400 sans toucher à la base', async () => {
  fake.calls.length = 0;
  const res = await sansCorps('/register');
  assert.equal(res.status, 400);
  assert.equal(fake.calls.length, 0);
});

test('vérification de username sans corps : indisponible, pas d\'erreur', async () => {
  const res = await sansCorps('/check-username');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).available, false);
});

test('demande d\'établissement sans corps : 400', async () => {
  fake.calls.length = 0;
  const res = await sansCorps('/etablissement-request');
  assert.equal(res.status, 400);
  assert.equal(fake.calls.length, 0);
});
