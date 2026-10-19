/**
 * Génération d'un agenda iCalendar (RFC 5545) à partir des devoirs.
 *
 * Chaque devoir daté devient un événement « journée entière » le jour où il
 * est à rendre. Les applications d'agenda (Google Agenda, Calendrier iOS,
 * Outlook...) s'abonnent à l'URL et la relisent régulièrement.
 */

const PRODID = '-//Eniv//Devoirs//FR';
const MAX_LINE_OCTETS = 75;

/** Échappe un texte selon la RFC 5545 (§ 3.3.11). */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Replie une ligne trop longue (75 octets max, suite précédée d'une espace),
 * sans couper un caractère UTF-8 en deux.
 */
function foldLine(line) {
  if (Buffer.byteLength(line) <= MAX_LINE_OCTETS) return line;

  const parts = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** « 2026-10-20 » ou Date -> « 20261020 » (jour UTC, comme stocké en base) */
function toIcsDate(value) {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

function nextDay(icsDate) {
  const y = Number(icsDate.slice(0, 4));
  const m = Number(icsDate.slice(4, 6));
  const d = Number(icsDate.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
}

function toIcsTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * @param {Object} options
 * @param {string} options.nom - Nom de l'agenda (ex. « Eniv · Terminale 3 »)
 * @param {Array} options.devoirs - lignes { id, titre, description, date, matiere_nom, fait, created_at }
 * @param {string} options.baseUrl - origine de l'app, pour le lien vers chaque devoir
 * @param {Date} [options.now]
 * @returns {string} contenu text/calendar
 */
function buildCalendar({ nom, devoirs, baseUrl, now = new Date() }) {
  const stamp = toIcsTimestamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(nom)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    // Fréquence de rafraîchissement suggérée aux applications (indicative)
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const devoir of devoirs) {
    const start = toIcsDate(devoir.date);
    if (!start) continue;

    const url = `${baseUrl}/dashboard/?devoir=${devoir.id}`;
    const prefix = devoir.fait ? '✅ ' : '';
    const matiere = devoir.matiere_nom ? `${devoir.matiere_nom} · ` : '';
    const description = [devoir.description, url].filter(Boolean).join('\n\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:devoir-${devoir.id}@eniv.fr`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${nextDay(start)}`,
      `SUMMARY:${escapeText(`${prefix}${matiere}${devoir.titre}`)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${url}`,
      'TRANSP:TRANSPARENT', // n'apparaît pas comme « occupé »
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, escapeText, foldLine, toIcsDate, nextDay };
