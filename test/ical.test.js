const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildCalendar, escapeText, foldLine, toIcsDate, nextDay } = require('../backend/services/ical');

describe('format iCalendar', () => {
  test('échappement des caractères spéciaux', () => {
    assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  });

  test('lignes repliées à 75 octets sans couper un caractère accentué', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      assert.ok(Buffer.byteLength(part) <= 75, part);
    }
    assert.equal(folded.replace(/\r\n /g, ''), line);
  });

  test('dates journée entière, y compris en fin de mois et d\'année', () => {
    assert.equal(toIcsDate('2026-10-20'), '20261020');
    assert.equal(toIcsDate(new Date('2026-10-20T00:00:00Z')), '20261020');
    assert.equal(nextDay('20261031'), '20261101');
    assert.equal(nextDay('20261231'), '20270101');
  });
});

describe('agenda', () => {
  const ics = buildCalendar({
    nom: 'Eniv · Terminale 3',
    baseUrl: 'https://app.eniv.fr',
    now: new Date('2026-10-18T12:00:00Z'),
    devoirs: [
      { id: 1, titre: 'Exercices 12, 13', description: 'Rédiger; soigner', date: new Date('2026-10-20T00:00:00Z'), matiere_nom: 'Maths', fait: 0 },
      { id: 2, titre: 'Dissertation', description: null, date: '2026-10-22', matiere_nom: 'Philo', fait: 1 },
      { id: 3, titre: 'Sans date', date: null },
    ],
  });

  test('structure et fins de ligne CRLF', () => {
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'toutes les fins de ligne doivent être CRLF');
    assert.match(ics, /X-WR-CALNAME:Eniv · Terminale 3/);
  });

  test('un événement journée entière par devoir daté', () => {
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.match(ics, /UID:devoir-1@eniv\.fr\r\nDTSTAMP:20261018T120000Z\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021/);
  });

  test('matière dans le titre, texte échappé, lien vers le devoir', () => {
    assert.match(ics, /SUMMARY:Maths · Exercices 12\\, 13/);
    assert.match(ics, /DESCRIPTION:Rédiger\\; soigner\\n\\nhttps:\/\/app\.eniv\.fr\/dashboard\/\?devoir=1/);
    assert.match(ics, /URL:https:\/\/app\.eniv\.fr\/dashboard\/\?devoir=1/);
  });

  test('devoir fait signalé par ✅', () => {
    assert.match(ics, /SUMMARY:✅ Philo · Dissertation/);
  });
});
