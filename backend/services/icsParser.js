// Lecture d'un calendrier iCalendar (RFC 5545) : uniquement ce qu'il faut pour
// afficher un emploi du temps.
//
// Limites assumées : RRULE n'est pas développé (seule la première occurrence
// est gardée). Les exports d'emploi du temps (ADE notamment) listent chaque
// séance comme un événement distinct, ce qui rend la récurrence inutile ici.

const DEFAULT_TIME_ZONE = 'Europe/Paris';
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * Erreur levée quand le texte n'est pas un calendrier exploitable.
 */
class IcsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IcsError';
  }
}

// Une ligne trop longue est coupée par CRLF suivi d'une espace ou d'une tabulation
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, char) => (char === 'n' || char === 'N' ? '\n' : char));
}

/**
 * Découpe « NOM;PARAM=VALEUR;...:VALEUR » (les « : » et « ; » entre guillemets
 * appartiennent au paramètre).
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

// Décalage (en ms) entre l'heure locale du fuseau et UTC à un instant donné
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
 * Convertit une heure murale d'un fuseau en instant UTC. Le décalage est
 * recalculé une fois pour tomber juste autour des changements d'heure.
 */
function wallTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall - timeZoneOffset(wall, timeZone);
  utc = wall - timeZoneOffset(utc, timeZone);
  return utc;
}

/**
 * Lit une valeur DTSTART/DTEND.
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

  // Heure flottante ou TZID : un TZID non reconnu (nom Windows par exemple)
  // est interprété dans le fuseau de l'établissement
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
 * Transforme les propriétés brutes d'un VEVENT en cours affichable.
 * @returns {object|null} Null si l'événement est annulé ou sans date exploitable
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

  // Journée entière : dates « AAAA-MM-JJ », fin exclusive comme dans la RFC
  if (start.allDay) {
    const fin = end?.allDay && end.date > start.date ? end.date : nextDay(start.date);
    return { ...event, journee: true, debut: start.date, fin };
  }

  const finTimestamp = end && !end.allDay && end.timestamp > start.timestamp
    ? end.timestamp
    : start.timestamp + DEFAULT_DURATION_MS;

  return {
    ...event,
    journee: false,
    debut: new Date(start.timestamp).toISOString(),
    fin: new Date(finTimestamp).toISOString()
  };
}

/**
 * Lit un calendrier ICS.
 * @param {string} text - Contenu du fichier .ics
 * @returns {Array<{uid: string, titre: string, lieu: string, description: string, journee: boolean, debut: string, fin: string}>}
 *   Triés par début. Instants en ISO UTC, ou dates « AAAA-MM-JJ » pour une journée entière.
 * @throws {IcsError} Si le texte n'est pas un calendrier
 */
function parseIcs(text) {
  const content = unfold(String(text).replace(/^﻿/, '')).trim();

  if (!/^BEGIN:VCALENDAR\b/i.test(content)) {
    throw new IcsError("Le lien ne renvoie pas un calendrier ICS");
  }

  const events = [];
  let props = null;
  // Profondeur des sous-composants (VALARM...) dont les propriétés sont ignorées
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

  // Comparaison de chaînes : « AAAA-MM-JJ » et l'ISO complet se trient ensemble
  return events.sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));
}

module.exports = { parseIcs, IcsError };
