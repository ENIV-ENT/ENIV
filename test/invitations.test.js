const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.JWT_SECRET = 'test-secret';

// Base factice : un admin (id 1, classe 4), lea@ex.fr déjà inscrite, tom@ex.fr déjà invité
const ADMIN = { id: 1, username: 'prof', role: 'admin', classe_id: 4 };
let nextId = 100;
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM users WHERE id')) return params[0] === 1 ? ADMIN : undefined;
  if (method === 'get' && sql.includes('FROM users WHERE email')) return params[0] === 'lea@ex.fr' ? { id: 9 } : undefined;
  if (method === 'get' && sql.includes('FROM invitations WHERE email')) return params[0] === 'tom@ex.fr' ? { id: 5 } : undefined;
  if (method === 'get' && sql.includes('FROM classes')) return { nom: 'Terminale 3' };
  if (method === 'run' && sql.startsWith('INSERT INTO invitations')) return { lastInsertRowid: nextId++ };
  return undefined;
});

// Service d'e-mail factice : échoue pour une adresse précise
const sent = [];
const emailFile = path.join(__dirname, '../backend/services/email.js');
require.cache[emailFile] = {
  id: emailFile, filename: emailFile, loaded: true,
  exports: {
    sendInvitationEmail: async (email, token, role, className) => {
      if (email === 'panne@ex.fr') throw new Error('Brevo indisponible');
      sent.push({ email, role, className });
    },
  },
};

const router = require('../backend/routes/invitations');
let server;
let url;
const tokenFor = (userId) => jwt.sign({ userId }, 'test-secret');

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/invitations', router);
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/invitations/bulk`;
});
after(() => server.close());

const bulk = (emails, token = tokenFor(1)) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ emails }),
});

describe('POST /api/invitations/bulk', () => {
  test('un statut par adresse, sans s\'arrêter aux refus', async (t) => {
    t.mock.method(console, 'error', () => {});
    const res = await bulk(['nina@ex.fr', 'LEA@ex.fr', 'tom@ex.fr', 'pas-une-adresse', 'panne@ex.fr', 'nina@ex.fr']);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.results, [
      { email: 'nina@ex.fr', status: 'envoyee' },
      { email: 'lea@ex.fr', status: 'deja_inscrit' },
      { email: 'tom@ex.fr', status: 'deja_invite' },
      { email: 'pas-une-adresse', status: 'invalide' },
      { email: 'panne@ex.fr', status: 'erreur' },
    ]);
    assert.equal(body.envoyees, 1);
    assert.equal(body.total, 5);
  });

  test('invitations créées dans la classe de l\'admin, rôle élève', async () => {
    assert.deepEqual(sent.at(-1), { email: 'nina@ex.fr', role: 'eleve', className: 'Terminale 3' });
    const insert = fake.calls.find((c) => c.sql.startsWith('INSERT INTO invitations'));
    assert.equal(insert.params[2], 'eleve');
    assert.equal(insert.params[3], 4);
  });

  test('invitation supprimée si l\'e-mail n\'a pas pu partir', async () => {
    assert.ok(fake.calls.some((c) => c.sql.startsWith('DELETE FROM invitations')));
  });

  test('liste vide ou trop longue refusée', async () => {
    assert.equal((await bulk([])).status, 400);
    const trop = Array.from({ length: 101 }, (_, i) => `eleve${i}@ex.fr`);
    assert.equal((await bulk(trop)).status, 400);
  });

  test('réservé aux admins', async () => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"emails":["a@b.fr"]}' });
    assert.equal(res.status, 401);
  });
});

describe('extractEmails (navigateur)', () => {
  let extractEmails;
  before(async () => {
    ({ extractEmails } = await import('../public/js/utils/emails.js'));
  });

  test('export CSV avec en-têtes et séparateurs variés', () => {
    const csv = 'Nom;Prénom;Email\nMartin;Léa;Lea.Martin@exemple.fr\nDurand;Tom;tom.durand@exemple.fr,\n"Petit";"Nina";nina@ac-nice.fr';
    assert.deepEqual(extractEmails(csv), ['lea.martin@exemple.fr', 'tom.durand@exemple.fr', 'nina@ac-nice.fr']);
  });

  test('doublons retirés sans tenir compte de la casse, point final ignoré', () => {
    assert.deepEqual(extractEmails('a@b.fr A@B.FR, a@b.fr.'), ['a@b.fr']);
  });

  test('texte sans adresse', () => {
    assert.deepEqual(extractEmails('rien ici'), []);
    assert.deepEqual(extractEmails(null), []);
  });
});
