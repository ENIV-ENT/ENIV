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
  exports: { sendJoinRequestEmail: async () => {}, sendSchoolRequestEmail: async () => {} },
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

/** Without a JSON body, Express 5 leaves req.body undefined. */
const withoutBody = (route) => fetch(`${url}${route}`, { method: 'POST' });

test('signup without a body: 400 without touching the database', async () => {
  fake.calls.length = 0;
  const res = await withoutBody('/register');
  assert.equal(res.status, 400);
  assert.equal(fake.calls.length, 0);
});

test('username check without a body: unavailable, no error', async () => {
  const res = await withoutBody('/check-username');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).available, false);
});

test('school request without a body: 400', async () => {
  fake.calls.length = 0;
  const res = await withoutBody('/etablissement-request');
  assert.equal(res.status, 400);
  assert.equal(fake.calls.length, 0);
});
