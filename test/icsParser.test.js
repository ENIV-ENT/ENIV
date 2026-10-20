const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIcs, IcsError } = require('../backend/services/icsParser');

const calendar = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

test('lit un cours en UTC, déplie les lignes et déséchappe le texte', () => {
  const [cours] = parseIcs(calendar(
    'BEGIN:VEVENT',
    'UID:abc-1',
    'DTSTART:20261013T123000Z',
    'DTEND:20261013T133000Z',
    'SUMMARY:TD - Anglais\\, groupe 1',
    'LOCATION:Salle 202',
    'DESCRIPTION:\\n\\nTD-Groupe 1\\nDupont Ma',
    ' rie\\n\\n',
    'END:VEVENT'
  ));

  assert.deepEqual(cours, {
    uid: 'abc-1',
    titre: 'TD - Anglais, groupe 1',
    lieu: 'Salle 202',
    description: 'TD-Groupe 1\nDupont Marie',
    journee: false,
    debut: '2026-10-13T12:30:00.000Z',
    fin: '2026-10-13T13:30:00.000Z'
  });
});

test('heure locale : Europe/Paris en été comme en hiver, TZID inconnu ramené à Paris', () => {
  const cours = parseIcs(calendar(
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Paris:20260715T083000',
    'DTEND;TZID=Europe/Paris:20260715T100000',
    'SUMMARY:été',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261215T083000',
    'SUMMARY:hiver flottant',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID="Romance Standard Time":20261215T140000',
    'SUMMARY:nom Windows',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/New_York:20261215T090000',
    'SUMMARY:autre fuseau',
    'END:VEVENT'
  ));

  const parTitre = Object.fromEntries(cours.map(c => [c.titre, c]));
  assert.equal(parTitre['été'].debut, '2026-07-15T06:30:00.000Z');
  assert.equal(parTitre['été'].fin, '2026-07-15T08:00:00.000Z');
  assert.equal(parTitre['hiver flottant'].debut, '2026-12-15T07:30:00.000Z');
  // DTEND absent : une heure par défaut
  assert.equal(parTitre['hiver flottant'].fin, '2026-12-15T08:30:00.000Z');
  assert.equal(parTitre['nom Windows'].debut, '2026-12-15T13:00:00.000Z');
  assert.equal(parTitre['autre fuseau'].debut, '2026-12-15T14:00:00.000Z');
});

test('journée entière : dates sans heure, fin exclusive', () => {
  const cours = parseIcs(calendar(
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261102',
    'DTEND;VALUE=DATE:20261104',
    'SUMMARY:Stage',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261231',
    'SUMMARY:Férié',
    'END:VEVENT'
  ));

  assert.deepEqual(cours.map(c => [c.titre, c.journee, c.debut, c.fin]), [
    ['Stage', true, '2026-11-02', '2026-11-04'],
    ['Férié', true, '2026-12-31', '2027-01-01']
  ]);
});

test('ignore les cours annulés et les alarmes, trie par début', () => {
  const cours = parseIcs(calendar(
    'BEGIN:VEVENT',
    'DTSTART:20261014T100000Z',
    'SUMMARY:second',
    'BEGIN:VALARM',
    'SUMMARY:rappel',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261014T080000Z',
    'SUMMARY:annulé',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261013T080000Z',
    'SUMMARY:premier',
    'END:VEVENT'
  ));

  assert.deepEqual(cours.map(c => c.titre), ['premier', 'second']);
});

test("refuse un contenu qui n'est pas un calendrier", () => {
  assert.throws(() => parseIcs('<html><body>Erreur</body></html>'), IcsError);
  assert.throws(() => parseIcs(''), IcsError);
  assert.deepEqual(parseIcs('﻿BEGIN:VCALENDAR\nEND:VCALENDAR'), []);
});
