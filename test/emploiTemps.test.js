const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';

// Lignes de emploi_temps_ics, par classe
let rows;
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM emploi_temps_ics')) {
    return rows.get(params[0]) && { ...rows.get(params[0]) };
  }
  if (method === 'all' && sql.startsWith('SELECT classe_id FROM emploi_temps_ics')) {
    return [...rows.keys()].map(classe_id => ({ classe_id }));
  }
  if (method === 'run' && sql.includes('SET evenements')) {
    const [evenements, fetched_at, last_attempt_at, classeId, url] = params;
    const row = rows.get(classeId);
    if (row?.url === url) Object.assign(row, { evenements, fetched_at, last_attempt_at, last_error: null });
  }
  if (method === 'run' && sql.includes('SET last_attempt_at')) {
    const [last_attempt_at, last_error, classeId, url] = params;
    const row = rows.get(classeId);
    if (row?.url === url) Object.assign(row, { last_attempt_at, last_error });
  }
  return undefined;
});

const safeRequest = require('../backend/services/safeRequest');
const { getEmploiTemps, refreshAll, FRESH_MS, RETRY_MS } = require('../backend/services/emploiTemps');

const NOW = Date.parse('2026-10-20T10:00:00Z');
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'DTSTART:20261021T070000Z', 'DTEND:20261021T080000Z', 'SUMMARY:CM - Réseaux', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261021T080000Z', 'DTEND:20261021T100000Z', 'SUMMARY:TP - Réseaux', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
const ANCIEN = [{ titre: 'Ancien cours', debut: '2026-10-19T07:00:00.000Z', fin: '2026-10-19T08:00:00.000Z' }];

// Source distante simulée : chaque appel consomme la réponse suivante
let responses;
let remoteCalls;

function source(...list) {
  responses = list;
}

function row(classeId, fields = {}) {
  rows.set(classeId, {
    classe_id: classeId,
    url: `https://edt.example.fr/${classeId}.ics`,
    evenements: null,
    fetched_at: null,
    last_attempt_at: null,
    last_error: null,
    ...fields
  });
}

beforeEach(() => {
  rows = new Map();
  remoteCalls = 0;
  fake.calls.length = 0;
  source();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  mock.method(safeRequest, 'openRemote', async () => {
    remoteCalls++;
    // Une promesse simule une source lente : la réponse arrive à sa résolution
    const next = await responses.shift();
    if (next instanceof Error) throw next;
    return { contentType: 'text/calendar', contentLength: null, stream: Readable.from([Buffer.from(next)]) };
  });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const panne = () => new safeRequest.ProxyError("La source de l'emploi du temps ne répond pas", 504);

test('sans lien ICS : non configuré, sans appel réseau', async () => {
  assert.deepEqual(await getEmploiTemps(4), { configure: false });
  assert.deepEqual(await getEmploiTemps(null), { configure: false });
  assert.equal(remoteCalls, 0);
});

test('version récente servie sans contacter la source', async () => {
  row(4, { evenements: JSON.stringify(ANCIEN), fetched_at: new Date(NOW - FRESH_MS + 1000) });

  const emploi = await getEmploiTemps(4);

  assert.equal(remoteCalls, 0);
  assert.deepEqual(emploi.evenements, ANCIEN);
  assert.equal(emploi.horsLigne, false);
});

test('version périmée : récupérée à nouveau puis enregistrée', async () => {
  row(4, { evenements: JSON.stringify(ANCIEN), fetched_at: new Date(NOW - FRESH_MS - 1000) });
  source(ICS);

  const emploi = await getEmploiTemps(4);

  assert.equal(remoteCalls, 1);
  assert.deepEqual(emploi.evenements.map(e => e.titre), ['CM - Réseaux', 'TP - Réseaux']);
  assert.equal(emploi.misAJour, new Date(NOW).toISOString());
  assert.equal(emploi.horsLigne, false);
  assert.equal(JSON.parse(rows.get(4).evenements).length, 2);
});

test('source en panne : la version précédente est servie et l\'erreur notée', async () => {
  const fetchedAt = new Date(NOW - 2 * 60 * 60 * 1000);
  row(4, { evenements: JSON.stringify(ANCIEN), fetched_at: fetchedAt });
  source(panne());

  const emploi = await getEmploiTemps(4);

  assert.deepEqual(emploi.evenements, ANCIEN);
  assert.equal(emploi.horsLigne, true);
  assert.equal(emploi.misAJour, fetchedAt.toISOString());
  assert.match(emploi.erreur, /ne répond pas/);
  assert.equal(rows.get(4).evenements, JSON.stringify(ANCIEN));
  assert.match(rows.get(4).last_error, /ne répond pas/);
});

test('après un échec, pas de nouvelle tentative pendant RETRY_MS', async () => {
  row(4, { evenements: JSON.stringify(ANCIEN), fetched_at: new Date(NOW - 2 * FRESH_MS) });
  source(panne(), ICS);

  await getEmploiTemps(4);
  mock.timers.tick(RETRY_MS - 1000);
  const pendant = await getEmploiTemps(4);
  assert.equal(remoteCalls, 1);
  assert.equal(pendant.horsLigne, true);

  // La nouvelle tentative se fait en arrière-plan : l'ancienne version est
  // servie sans l'attendre
  mock.timers.tick(2000);
  const apres = await getEmploiTemps(4);
  assert.equal(remoteCalls, 2);
  assert.equal(apres.horsLigne, true);
  assert.deepEqual(apres.evenements, ANCIEN);

  await new Promise(setImmediate);
  const rafraichi = await getEmploiTemps(4);
  assert.equal(remoteCalls, 2);
  assert.equal(rafraichi.horsLigne, false);
  assert.equal(rafraichi.evenements.length, 2);
});

test('après un échec, une source qui ne répond plus ne retarde pas la lecture', async () => {
  row(4, {
    evenements: JSON.stringify(ANCIEN),
    fetched_at: new Date(NOW - 2 * FRESH_MS),
    last_attempt_at: new Date(NOW - RETRY_MS - 1000),
    last_error: "La source de l'emploi du temps ne répond pas"
  });
  let repondre;
  source(new Promise(resolve => { repondre = resolve; }));

  const [a, b] = await Promise.all([getEmploiTemps(4), getEmploiTemps(4)]);

  assert.equal(remoteCalls, 1);
  assert.deepEqual(a.evenements, ANCIEN);
  assert.equal(a.horsLigne, true);
  assert.deepEqual(b, a);

  // Pendant la tentative en cours, pas de deuxième appel
  await getEmploiTemps(4);
  assert.equal(remoteCalls, 1);

  repondre(ICS);
  await new Promise(setImmediate);
  assert.equal(JSON.parse(rows.get(4).evenements).length, 2);
  assert.equal(rows.get(4).last_error, null);
});

test('échec sans aucune version gardée : erreur', async () => {
  row(4);
  source(panne());

  await assert.rejects(getEmploiTemps(4), { name: 'ProxyError', status: 502, message: /ne répond pas/ });
  // Pendant RETRY_MS, l'erreur est renvoyée sans réessayer
  await assert.rejects(getEmploiTemps(4), { status: 502 });
  assert.equal(remoteCalls, 1);
});

test('échec sans aucune version gardée : après RETRY_MS, la lecture attend la source', async () => {
  row(4);
  source(panne(), ICS);

  await assert.rejects(getEmploiTemps(4), { status: 502 });
  mock.timers.tick(RETRY_MS + 1000);

  const emploi = await getEmploiTemps(4);
  assert.equal(remoteCalls, 2);
  assert.equal(emploi.horsLigne, false);
  assert.equal(emploi.evenements.length, 2);
});

test('un calendrier vide ou invalide n\'écrase pas un emploi du temps existant', async () => {
  row(4, { evenements: JSON.stringify(ANCIEN), fetched_at: new Date(NOW - 2 * FRESH_MS) });
  source(EMPTY_ICS, '<html>Maintenance</html>');

  const vide = await getEmploiTemps(4, { force: true });
  assert.equal(vide.horsLigne, true);
  assert.deepEqual(vide.evenements, ANCIEN);

  const html = await getEmploiTemps(4, { force: true });
  assert.equal(html.horsLigne, true);
  assert.match(html.erreur, /pas un calendrier/);
  assert.equal(rows.get(4).evenements, JSON.stringify(ANCIEN));
});

test('lectures simultanées : une seule requête vers la source', async () => {
  row(4);
  source(ICS);

  const [a, b, c] = await Promise.all([getEmploiTemps(4), getEmploiTemps(4), getEmploiTemps(4)]);

  assert.equal(remoteCalls, 1);
  assert.equal(a.evenements.length, 2);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test('un lien changé pendant la récupération ne reçoit pas l\'ancien calendrier', async () => {
  row(4);
  source(ICS);

  const pending = getEmploiTemps(4);
  rows.get(4).url = 'https://edt.example.fr/nouveau.ics';
  await pending;

  assert.equal(rows.get(4).evenements, null);
});

test('refreshAll : toutes les classes, même récentes, sans s\'arrêter sur un échec', async () => {
  row(1, { evenements: JSON.stringify(ANCIEN), fetched_at: new Date(NOW - 60 * 1000) });
  row(2);
  row(3, { evenements: JSON.stringify(ANCIEN), fetched_at: new Date(NOW - 2 * FRESH_MS) });
  source(ICS, panne(), panne());

  const warn = mock.method(console, 'warn', () => {});
  const resultat = await refreshAll({ pauseMs: 0 });

  assert.deepEqual(resultat, { ok: 1, echecs: 2 });
  assert.equal(remoteCalls, 3);
  assert.equal(JSON.parse(rows.get(1).evenements).length, 2);
  assert.equal(rows.get(2).evenements, null);
  assert.equal(rows.get(3).evenements, JSON.stringify(ANCIEN));
  assert.equal(warn.mock.callCount(), 2);
});
