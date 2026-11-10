const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./helpers/fakeDb');

process.env.NODE_ENV = 'test';

const EVENTS = [
  { titre: 'CM - R504 Qualité algo', lieu: 'Salle 1', journee: false, debut: '2026-11-10T08:00:00.000Z', fin: '2026-11-10T09:30:00.000Z' },
  { titre: 'TD', lieu: '', journee: false, debut: '2026-11-11T08:00:00.000Z', fin: '2026-11-11T09:30:00.000Z' }
];
let configured = true;

installFakeDb((method, sql) => {
  if (sql.startsWith('SELECT * FROM emploi_temps_ics')) {
    return configured && {
      classe_id: 1, url: 'x', fetched_at: new Date().toISOString(), last_error: null, evenements: JSON.stringify(EVENTS)
    };
  }
  if (sql.startsWith('SELECT id, nom, couleur')) return [{ id: 35, nom: 'R504 - Qualité algorithmique', couleur: '#ffffff' }];
  return undefined;
});

const { createMcpServer } = require('../backend/services/mcpServer');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

async function call(args) {
  const server = createMcpServer({ id: 1, classe_id: 1 });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client.callTool({ name: 'emploi_du_temps', arguments: args });
}

test('emploi_du_temps returns lessons in Paris time with their subject', async () => {
  const result = await call({ du: '2026-11-10', au: '2026-11-10' });
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.nombre, 1);
  assert.deepEqual(
    [data.cours[0].debut, data.cours[0].fin, data.cours[0].lieu, data.cours[0].matiere],
    ['09:00', '10:30', 'Salle 1', 'R504 - Qualité algorithmique']
  );
});

test('emploi_du_temps rejects an inverted range', async () => {
  const result = await call({ du: '2026-11-12', au: '2026-11-10' });
  assert.equal(result.isError, true);
});

test('emploi_du_temps explains when no timetable is configured', async () => {
  configured = false;
  const result = await call({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Aucun emploi du temps/);
});
