const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
const { resolveJwtSecret } = require('../backend/config/jwt');
const { loginLimiter } = require('../backend/middleware/rateLimit');

test('JWT_SECRET manquant : refus en production', () => {
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET manquant/);
});

test('JWT_SECRET manquant : valeur de développement hors production', () => {
  assert.equal(typeof resolveJwtSecret({ NODE_ENV: 'development' }), 'string');
  assert.equal(typeof resolveJwtSecret({ NODE_ENV: 'test' }), 'string');
});

test('JWT_SECRET fourni : utilisé tel quel', () => {
  const secret = 'x'.repeat(48);
  assert.equal(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret }), secret);
});

test('connexion : 10 échecs par identifiant puis 429, plafond large par IP, les succès ne comptent pas', async (t) => {
  const app = express();
  app.use(express.json());
  app.post('/login', loginLimiter, (req, res) => {
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

  for (let i = 0; i < 5; i++) assert.equal(await login('alice', 'ok'), 200);
  for (let i = 0; i < 10; i++) assert.equal(await login('alice', 'mauvais'), 401);
  assert.equal(await login('Alice', 'mauvais'), 429);
  // Même IP, autre élève : pas bloqué par les erreurs d'alice
  assert.equal(await login('bob', 'mauvais'), 401);
  // Plafond par IP : beaucoup d'identifiants différents finissent bloqués
  for (let i = 0; i < 100; i++) await login(`eleve${i}`, 'mauvais');
  assert.equal(await login('carol', 'mauvais'), 429);
});
