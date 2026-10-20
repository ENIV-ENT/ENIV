const { test, before, after, beforeEach, mock } = require('node:test');
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
  return undefined;
});

const emailFile = path.join(__dirname, '../backend/services/email.js');
require.cache[emailFile] = { id: emailFile, filename: emailFile, loaded: true, exports: {} };

const safeRequest = require('../backend/services/safeRequest');
const router = require('../backend/routes/admin');
let server;
let url;

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/admin/settings/emploi-temps-ics`;
});
after(() => server.close());

beforeEach(() => {
  fake.calls.length = 0;
  mock.restoreAll();
});

const save = (userId, lien) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId }, JWT_SECRET)}` },
  body: JSON.stringify({ lien }),
});

const writes = () => fake.calls.filter((c) => c.method === 'run' && c.sql.includes('emploi_temps_ics'));

test('un élève ne peut pas configurer le lien ICS', async () => {
  const res = await save(1, 'https://edt.example.fr/cal.ics');
  assert.equal(res.status, 403);
  assert.equal(writes().length, 0);
});

test('liens refusés : autre schéma, adresse interne, trop long', async () => {
  for (const lien of [
    'ftp://edt.example.fr/cal.ics',
    'http://127.0.0.1:8080/cal.ics',
    'http://[::1]/cal.ics',
    'pas une url',
    `https://edt.example.fr/${'a'.repeat(2100)}`,
  ]) {
    const res = await save(2, lien);
    assert.equal(res.status, 400, lien);
  }
  assert.equal(writes().length, 0);
});

test('sans corps JSON : pas d\'erreur 500, traité comme un lien absent', async () => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt.sign({ userId: 2 }, JWT_SECRET)}` },
  });
  assert.equal(res.status, 200);
  assert.match(writes()[0].sql, /^DELETE FROM emploi_temps_ics/);
});

test('un lien vide supprime la configuration', async () => {
  const res = await save(2, '  ');
  assert.equal(res.status, 200);
  const [del] = writes();
  assert.match(del.sql, /^DELETE FROM emploi_temps_ics/);
  assert.deepEqual(del.params, [4]);
});

test('source injoignable : le lien est enregistré avec un avertissement', async () => {
  mock.method(safeRequest, 'openRemote', async () => {
    throw new safeRequest.ProxyError("La source de l'emploi du temps ne répond pas", 504);
  });
  fake.setHandler((method, sql, params) => {
    if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return USERS[params[0]];
    if (method === 'get' && sql.startsWith('SELECT * FROM emploi_temps_ics')) {
      return { classe_id: 4, url: 'https://edt.example.fr/cal.ics', evenements: null, last_error: null };
    }
    return undefined;
  });

  const res = await save(2, 'https://edt.example.fr/cal.ics');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.match(body.avertissement, /ne répond pas/);
  assert.match(writes()[0].sql, /^INSERT INTO emploi_temps_ics/);
  assert.deepEqual(writes()[0].params, [4, 'https://edt.example.fr/cal.ics']);
});
