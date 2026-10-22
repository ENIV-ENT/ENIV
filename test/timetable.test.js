const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';

/** Rows of emploi_temps_ics, by class. */
let rows;
const fake = installFakeDb((method, sql, params) => {
  if (method === 'get' && sql.startsWith('SELECT * FROM emploi_temps_ics')) {
    return rows.get(params[0]) && { ...rows.get(params[0]) };
  }
  if (method === 'all' && sql.startsWith('SELECT classe_id FROM emploi_temps_ics')) {
    return [...rows.keys()].map(classId => ({ classe_id: classId }));
  }
  if (method === 'run' && sql.includes('SET evenements')) {
    const [events, fetchedAt, lastAttemptAt, classId, url] = params;
    const row = rows.get(classId);
    if (row?.url === url) Object.assign(row, { evenements: events, fetched_at: fetchedAt, last_attempt_at: lastAttemptAt, last_error: null });
  }
  if (method === 'run' && sql.includes('SET last_attempt_at')) {
    const [lastAttemptAt, lastError, classId, url] = params;
    const row = rows.get(classId);
    if (row?.url === url) Object.assign(row, { last_attempt_at: lastAttemptAt, last_error: lastError });
  }
  return undefined;
});

const safeRequest = require('../backend/services/safeRequest');
const { getTimetable, refreshAll, FRESH_MS, RETRY_MS } = require('../backend/services/timetable');

const NOW = Date.parse('2026-10-20T10:00:00Z');
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'DTSTART:20261021T070000Z', 'DTEND:20261021T080000Z', 'SUMMARY:CM - Réseaux', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261021T080000Z', 'DTEND:20261021T100000Z', 'SUMMARY:TP - Réseaux', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
const PREVIOUS = [{ titre: 'Ancien cours', debut: '2026-10-19T07:00:00.000Z', fin: '2026-10-19T08:00:00.000Z' }];

/**
 * Fake remote source: each call consumes the next response. A promise simulates a
 * slow source: the response arrives when it resolves.
 */
let responses;
let remoteCalls;

function source(...list) {
  responses = list;
}

function row(classId, fields = {}) {
  rows.set(classId, {
    classe_id: classId,
    url: `https://edt.example.fr/${classId}.ics`,
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
    const next = await responses.shift();
    if (next instanceof Error) throw next;
    return { contentType: 'text/calendar', contentLength: null, stream: Readable.from([Buffer.from(next)]) };
  });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const outage = () => new safeRequest.ProxyError("La source de l'emploi du temps ne répond pas", 504);

test('without an ICS link: not configured, no network call', async () => {
  assert.deepEqual(await getTimetable(4), { configure: false });
  assert.deepEqual(await getTimetable(null), { configure: false });
  assert.equal(remoteCalls, 0);
});

test('recent version served without contacting the source', async () => {
  row(4, { evenements: JSON.stringify(PREVIOUS), fetched_at: new Date(NOW - FRESH_MS + 1000) });

  const timetable = await getTimetable(4);

  assert.equal(remoteCalls, 0);
  assert.deepEqual(timetable.evenements, PREVIOUS);
  assert.equal(timetable.horsLigne, false);
});

test('stale version: fetched again then saved', async () => {
  row(4, { evenements: JSON.stringify(PREVIOUS), fetched_at: new Date(NOW - FRESH_MS - 1000) });
  source(ICS);

  const timetable = await getTimetable(4);

  assert.equal(remoteCalls, 1);
  assert.deepEqual(timetable.evenements.map(e => e.titre), ['CM - Réseaux', 'TP - Réseaux']);
  assert.equal(timetable.misAJour, new Date(NOW).toISOString());
  assert.equal(timetable.horsLigne, false);
  assert.equal(JSON.parse(rows.get(4).evenements).length, 2);
});

test('source down: the previous version is served and the error recorded', async () => {
  const fetchedAt = new Date(NOW - 2 * 60 * 60 * 1000);
  row(4, { evenements: JSON.stringify(PREVIOUS), fetched_at: fetchedAt });
  source(outage());

  const timetable = await getTimetable(4);

  assert.deepEqual(timetable.evenements, PREVIOUS);
  assert.equal(timetable.horsLigne, true);
  assert.equal(timetable.misAJour, fetchedAt.toISOString());
  assert.match(timetable.erreur, /ne répond pas/);
  assert.equal(rows.get(4).evenements, JSON.stringify(PREVIOUS));
  assert.match(rows.get(4).last_error, /ne répond pas/);
});

test('after a failure, no new attempt during RETRY_MS; the next one runs in the background', async () => {
  row(4, { evenements: JSON.stringify(PREVIOUS), fetched_at: new Date(NOW - 2 * FRESH_MS) });
  source(outage(), ICS);

  await getTimetable(4);
  mock.timers.tick(RETRY_MS - 1000);
  const during = await getTimetable(4);
  assert.equal(remoteCalls, 1);
  assert.equal(during.horsLigne, true);

  mock.timers.tick(2000);
  const after = await getTimetable(4);
  assert.equal(remoteCalls, 2);
  assert.equal(after.horsLigne, true);
  assert.deepEqual(after.evenements, PREVIOUS);

  await new Promise(setImmediate);
  const refreshed = await getTimetable(4);
  assert.equal(remoteCalls, 2);
  assert.equal(refreshed.horsLigne, false);
  assert.equal(refreshed.evenements.length, 2);
});

test('after a failure, a source that no longer answers does not delay the read', async () => {
  row(4, {
    evenements: JSON.stringify(PREVIOUS),
    fetched_at: new Date(NOW - 2 * FRESH_MS),
    last_attempt_at: new Date(NOW - RETRY_MS - 1000),
    last_error: "La source de l'emploi du temps ne répond pas"
  });
  let answer;
  source(new Promise(resolve => { answer = resolve; }));

  const [a, b] = await Promise.all([getTimetable(4), getTimetable(4)]);

  assert.equal(remoteCalls, 1);
  assert.deepEqual(a.evenements, PREVIOUS);
  assert.equal(a.horsLigne, true);
  assert.deepEqual(b, a);

  await getTimetable(4);
  assert.equal(remoteCalls, 1, 'no second call while the attempt is in progress');

  answer(ICS);
  await new Promise(setImmediate);
  assert.equal(JSON.parse(rows.get(4).evenements).length, 2);
  assert.equal(rows.get(4).last_error, null);
});

test('failure without any kept version: error, returned again without retrying during RETRY_MS', async () => {
  row(4);
  source(outage());

  await assert.rejects(getTimetable(4), { name: 'ProxyError', status: 502, message: /ne répond pas/ });
  await assert.rejects(getTimetable(4), { status: 502 });
  assert.equal(remoteCalls, 1);
});

test('failure without any kept version: after RETRY_MS, the read waits for the source', async () => {
  row(4);
  source(outage(), ICS);

  await assert.rejects(getTimetable(4), { status: 502 });
  mock.timers.tick(RETRY_MS + 1000);

  const timetable = await getTimetable(4);
  assert.equal(remoteCalls, 2);
  assert.equal(timetable.horsLigne, false);
  assert.equal(timetable.evenements.length, 2);
});

test('an empty or invalid calendar does not overwrite an existing timetable', async () => {
  row(4, { evenements: JSON.stringify(PREVIOUS), fetched_at: new Date(NOW - 2 * FRESH_MS) });
  source(EMPTY_ICS, '<html>Maintenance</html>');

  const empty = await getTimetable(4, { force: true });
  assert.equal(empty.horsLigne, true);
  assert.deepEqual(empty.evenements, PREVIOUS);

  const html = await getTimetable(4, { force: true });
  assert.equal(html.horsLigne, true);
  assert.match(html.erreur, /pas un calendrier/);
  assert.equal(rows.get(4).evenements, JSON.stringify(PREVIOUS));
});

test('simultaneous reads: a single request to the source', async () => {
  row(4);
  source(ICS);

  const [a, b, c] = await Promise.all([getTimetable(4), getTimetable(4), getTimetable(4)]);

  assert.equal(remoteCalls, 1);
  assert.equal(a.evenements.length, 2);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test('a link changed during the fetch does not get the old calendar', async () => {
  row(4);
  source(ICS);

  const pending = getTimetable(4);
  rows.get(4).url = 'https://edt.example.fr/nouveau.ics';
  await pending;

  assert.equal(rows.get(4).evenements, null);
});

test('refreshAll: every class, even recent ones, without stopping on a failure', async () => {
  row(1, { evenements: JSON.stringify(PREVIOUS), fetched_at: new Date(NOW - 60 * 1000) });
  row(2);
  row(3, { evenements: JSON.stringify(PREVIOUS), fetched_at: new Date(NOW - 2 * FRESH_MS) });
  source(ICS, outage(), outage());

  const warn = mock.method(console, 'warn', () => {});
  const result = await refreshAll({ pauseMs: 0 });

  assert.deepEqual(result, { ok: 1, failed: 2 });
  assert.equal(remoteCalls, 3);
  assert.equal(JSON.parse(rows.get(1).evenements).length, 2);
  assert.equal(rows.get(2).evenements, null);
  assert.equal(rows.get(3).evenements, JSON.stringify(PREVIOUS));
  assert.equal(warn.mock.callCount(), 2);
});
