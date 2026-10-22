const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
const { resolveJwtSecret } = require('../backend/config/jwt');
const { loginLimiter } = require('../backend/middleware/rateLimit');

test('missing JWT_SECRET: refused in production', () => {
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET is missing/);
});

test('missing JWT_SECRET: development value outside production', () => {
  assert.equal(typeof resolveJwtSecret({ NODE_ENV: 'development' }), 'string');
  assert.equal(typeof resolveJwtSecret({ NODE_ENV: 'test' }), 'string');
});

test('sample JWT_SECRET: refused in production', () => {
  const secret = 'your-jwt-secret-key-change-in-production';
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret }), /public sample value/);
  assert.equal(resolveJwtSecret({ NODE_ENV: 'development', JWT_SECRET: secret }), secret);
});

test('JWT_SECRET given: used as is', () => {
  const secret = 'x'.repeat(48);
  assert.equal(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret }), secret);
});

test('login: 10 failures per username then 429, generous limit per IP, only 401s count', async (t) => {
  const app = express();
  app.use(express.json());
  app.post('/login', loginLimiter, (req, res) => {
    if (!req.body.password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
    if (req.body.password === 'ok') return res.json({ success: true });
    res.status(401).json({ error: 'Identifiants invalides' });
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/login`;
  const login = (username, password) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.status);

  const incompleteRequestsBlockNobody = () => login('alice', '');
  const sameIpOtherStudent = () => login('bob', 'mauvais');
  const manyUsernamesFromOneIp = (i) => login(`eleve${i}`, 'mauvais');

  for (let i = 0; i < 5; i++) assert.equal(await login('alice', 'ok'), 200);
  for (let i = 0; i < 20; i++) assert.equal(await incompleteRequestsBlockNobody(), 400);
  for (let i = 0; i < 10; i++) assert.equal(await login('alice', 'mauvais'), 401);
  assert.equal(await login('Alice', 'mauvais'), 429);
  assert.equal(await sameIpOtherStudent(), 401);
  for (let i = 0; i < 100; i++) await manyUsernamesFromOneIp(i);
  assert.equal(await login('carol', 'mauvais'), 429);
});
