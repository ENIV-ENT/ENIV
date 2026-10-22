const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';

const TOKEN = 'A'.repeat(43);
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.includes('calendar_token = ?')) {
    return params[0] === TOKEN ? { id: 3, classe_id: 1, classe_nom: 'Terminale 3' } : null;
  }
  if (method === 'all' && sql.includes('FROM devoirs')) {
    return [{ id: 1, titre: 'TP', description: null, date: new Date('2026-10-20T00:00:00Z'), matiere_nom: 'Physique', fait: 0 }];
  }
  return undefined;
});

const router = require('../backend/routes/calendar');
let server;
let base;

before(() => {
  const app = express();
  app.use('/api/calendar', router);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/calendar`;
});
after(() => server.close());

test('malformed token: 404 without a database query', async () => {
  fake.calls.length = 0;
  const res = await fetch(`${base}/nimportequoi.ics`);
  assert.equal(res.status, 404);
  assert.equal(fake.calls.length, 0);
});

test('unknown token: 404', async () => {
  const res = await fetch(`${base}/${'B'.repeat(43)}.ics`);
  assert.equal(res.status, 404);
});

test('valid token: calendar of the class as text/calendar', async () => {
  const res = await fetch(`${base}/${TOKEN}.ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/calendar/);
  const body = await res.text();
  assert.match(body, /X-WR-CALNAME:Eniv · Terminale 3/);
  assert.match(body, /SUMMARY:Physique · TP/);
  const assignmentsQuery = fake.calls.find((c) => c.method === 'all');
  assert.deepEqual(assignmentsQuery.params.slice(0, 2), [3, 1]);
});

test('link management: login required', async () => {
  const res = await fetch(`${base}/link`);
  assert.equal(res.status, 401);
});
