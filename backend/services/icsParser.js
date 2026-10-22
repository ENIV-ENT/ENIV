/**
 * Reads an iCalendar file (RFC 5545): only what is needed to show a timetable.
 *
 * Known limit: RRULE is not expanded (only the first occurrence is kept).
 * Timetable exports (ADE in particular) list each lesson as a separate event,
 * which makes recurrence useless here.
 *
 * The event keys (titre, lieu, journee, debut, fin) are stored as JSON in
 * emploi_temps_ics.evenements and sent to the browser: they must not change.
 * @module
 */

const DEFAULT_TIME_ZONE = 'Europe/Paris';
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * Thrown when the text is not a usable calendar. Its message is shown to the user.
 */
class IcsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IcsError';
  }
}

/** A line that is too long is split by CRLF followed by a space or a tab. */
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, char) => (char === 'n' || char === 'N' ? '\n' : char));
}

/**
 * Splits "NAME;PARAM=VALUE;...:VALUE" (the ":" and ";" between quotes belong to
 * the parameter).
 * @returns {{name: string, params: Object<string, string>, value: string}|null}
 */
function parseLine(line) {
  let inQuotes = false;
  let colon = -1;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }

  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const parts = [];
  let current = '';
  inQuotes = false;
  for (const char of head) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === ';' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  const params = {};
  for (const param of parts.slice(1)) {
    const eq = param.indexOf('=');
    if (eq === -1) continue;
    params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
  }

  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (in ms) between the local time of the zone and UTC at a given instant. */
function timeZoneOffset(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(timestamp));

  const get = type => Number(parts.find(p => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - timestamp;
}

/**
 * Converts a wall-clock time of a zone to a UTC instant. The offset is computed
 * a second time to be right around daylight saving changes.
 */
function wallTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall - timeZoneOffset(wall, timeZone);
  utc = wall - timeZoneOffset(utc, timeZone);
  return utc;
}

/**
 * Reads a DTSTART/DTEND value. A floating time, or a TZID that is not recognized
 * (a Windows name for instance), is read in the school's time zone.
 * @returns {{allDay: true, date: string}|{allDay: false, timestamp: number}|null}
 */
function parseDate(value, params) {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    return { allDay: true, date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}` };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);

  if (match[7] === 'Z') {
    return { allDay: false, timestamp: Date.UTC(year, month - 1, day, hour, minute, second) };
  }

  const timeZone = params.TZID && isValidTimeZone(params.TZID) ? params.TZID : DEFAULT_TIME_ZONE;
  return { allDay: false, timestamp: wallTimeToUtc(year, month, day, hour, minute, second, timeZone) };
}

function nextDay(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function cleanDescription(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Turns the raw properties of a VEVENT into a displayable lesson. All-day events
 * use "YYYY-MM-DD" dates with an exclusive end, as in the RFC.
 * @returns {object|null} null if the event is cancelled or has no usable date
 */
function toEvent(props) {
  if ((props.STATUS?.value || '').toUpperCase() === 'CANCELLED') return null;
  if (!props.DTSTART) return null;

  const start = parseDate(props.DTSTART.value, props.DTSTART.params);
  if (!start) return null;

  const end = props.DTEND ? parseDate(props.DTEND.value, props.DTEND.params) : null;
  const text = name => (props[name] ? unescapeText(props[name].value).trim() : '');

  const event = {
    uid: text('UID'),
    titre: text('SUMMARY'),
    lieu: text('LOCATION'),
    description: cleanDescription(text('DESCRIPTION'))
  };

  if (start.allDay) {
    const endDate = end?.allDay && end.date > start.date ? end.date : nextDay(start.date);
    return { ...event, journee: true, debut: start.date, fin: endDate };
  }

  const endTimestamp = end && !end.allDay && end.timestamp > start.timestamp
    ? end.timestamp
    : start.timestamp + DEFAULT_DURATION_MS;

  return {
    ...event,
    journee: false,
    debut: new Date(start.timestamp).toISOString(),
    fin: new Date(endTimestamp).toISOString()
  };
}

/**
 * Reads an ICS calendar. Properties of sub-components (VALARM...) are ignored.
 * Sorting compares strings: "YYYY-MM-DD" and full ISO instants sort together.
 * @param {string} text - content of the .ics file
 * @returns {Array<{uid: string, titre: string, lieu: string, description: string, journee: boolean, debut: string, fin: string}>}
 *   sorted by start; instants in ISO UTC, or "YYYY-MM-DD" dates for all-day events
 * @throws {IcsError} if the text is not a calendar
 */
function parseIcs(text) {
  const content = unfold(String(text).replace(/^\uFEFF/, '')).trim();

  if (!/^BEGIN:VCALENDAR\b/i.test(content)) {
    throw new IcsError("Le lien ne renvoie pas un calendrier ICS");
  }

  const events = [];
  let props = null;
  let nested = 0;

  for (const rawLine of content.split('\n')) {
    if (!rawLine) continue;
    const line = parseLine(rawLine);
    if (!line) continue;

    if (line.name === 'BEGIN') {
      if (line.value.toUpperCase() === 'VEVENT' && !props) props = {};
      else if (props) nested++;
      continue;
    }

    if (line.name === 'END') {
      if (props && nested) nested--;
      else if (props && line.value.toUpperCase() === 'VEVENT') {
        const event = toEvent(props);
        if (event) events.push(event);
        props = null;
      }
      continue;
    }

    if (props && !nested && !props[line.name]) {
      props[line.name] = line;
    }
  }

  return events.sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));
}

module.exports = { parseIcs, IcsError };
