/**
 * Builds an iCalendar feed (RFC 5545) from the assignments.
 *
 * Each dated assignment becomes an all-day event on its due date. Calendar apps
 * (Google Calendar, iOS Calendar, Outlook...) subscribe to the URL and read it
 * again regularly. Events are transparent so they do not show as "busy".
 * @module
 */

const PRODID = '-//Eniv//Devoirs//FR';
const MAX_LINE_OCTETS = 75;

/** Escapes a text as in RFC 5545 (§ 3.3.11). */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a line that is too long (75 octets max, continuation preceded by a
 * space), without splitting a UTF-8 character.
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

/** "2026-10-20" or Date -> "20261020" (UTC day, as stored in the database) */
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
 * The refresh interval suggested to the apps is only indicative.
 * @param {Object} options
 * @param {string} options.name - calendar name (e.g. "Eniv · Terminale 3")
 * @param {Array} options.assignments - rows { id, titre, description, date, matiere_nom, fait, created_at }
 * @param {string} options.baseUrl - origin of the app, for the link to each assignment
 * @param {Date} [options.now]
 * @returns {string} text/calendar content
 */
function buildCalendar({ name, assignments, baseUrl, now = new Date() }) {
  const stamp = toIcsTimestamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const assignment of assignments) {
    const start = toIcsDate(assignment.date);
    if (!start) continue;

    const url = `${baseUrl}/dashboard/?devoir=${assignment.id}`;
    const prefix = assignment.fait ? '✅ ' : '';
    const subject = assignment.matiere_nom ? `${assignment.matiere_nom} · ` : '';
    const description = [assignment.description, url].filter(Boolean).join('\n\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:devoir-${assignment.id}@eniv.fr`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${nextDay(start)}`,
      `SUMMARY:${escapeText(`${prefix}${subject}${assignment.titre}`)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${url}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, escapeText, foldLine, toIcsDate, nextDay };
