/**
 * Timetable of a class, imported from an ICS link (ADE, Hyperplanning...).
 *
 * The last successfully fetched version is kept in the database (table
 * emploi_temps_ics): when the source goes down, that version is served, with its
 * update date. The scheduler refreshes it regularly (refreshAll); user requests
 * only fetch it themselves when it got old. After a failure, they no longer wait
 * for the source: the kept version is served at once and the new attempt runs in
 * the background.
 *
 * safeRequest is called through the module object so tests can replace openRemote.
 * @module
 */

const db = require('../models/dbHelper');
const safeRequest = require('./safeRequest');
const { parseIcs, IcsError } = require('./icsParser');

/** Past this age, a read triggers a new fetch. */
const FRESH_MS = 30 * 60 * 1000;
/**
 * Wait after a failure before trying again: a whole class opening the page during
 * an outage must not hit the source every time.
 */
const RETRY_MS = 5 * 60 * 1000;
/** Pause between two classes during the scheduled refresh. */
const REFRESH_PAUSE_MS = 2000;

const MAX_BYTES = 10 * 1024 * 1024;
/**
 * Socket inactivity, then maximum duration of the whole download: a source that
 * sends a byte now and then must not block refreshAll, which handles the classes
 * one after the other.
 */
const TIMEOUT_MS = 15000;
const DEADLINE_MS = 30000;

/**
 * Depending on the server, an .ics file is served with one of these types; the
 * content is checked by parseIcs anyway.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'text/calendar',
  'text/plain',
  'application/ics',
  'application/octet-stream'
]);

/** Fetches in progress, per class: simultaneous reads share the same one. */
const inFlight = new Map();

/**
 * ICS link configured for a class.
 * @param {number} classId
 * @returns {Promise<string|null>}
 */
async function getSource(classId) {
  const row = await db.get('SELECT url FROM emploi_temps_ics WHERE classe_id = ?', [classId]);
  return row ? row.url : null;
}

/**
 * Saves the ICS link of a class. Changing the link clears the version kept for
 * the previous one; an empty link removes the configuration.
 * MySQL evaluates the assignments in order: url is updated last so the
 * comparisons apply to the previous link.
 * @param {number} classId
 * @param {string|null} url - link already validated
 */
async function setSource(classId, url) {
  if (!url) {
    await db.run('DELETE FROM emploi_temps_ics WHERE classe_id = ?', [classId]);
    return;
  }

  await db.run(
    `INSERT INTO emploi_temps_ics (classe_id, url) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       evenements = IF(url = VALUES(url), evenements, NULL),
       fetched_at = IF(url = VALUES(url), fetched_at, NULL),
       last_attempt_at = IF(url = VALUES(url), last_attempt_at, NULL),
       last_error = IF(url = VALUES(url), last_error, NULL),
       url = VALUES(url)`,
    [classId, url]
  );
}

function parseStored(events) {
  if (events == null) return null;
  return typeof events === 'string' ? JSON.parse(events) : events;
}

function present(row, events) {
  return {
    configure: true,
    evenements: events,
    misAJour: row.fetched_at ? new Date(row.fetched_at).toISOString() : null,
    horsLigne: Boolean(row.last_error),
    ...(row.last_error ? { erreur: row.last_error } : {})
  };
}

function age(date) {
  return date ? Date.now() - new Date(date).getTime() : Infinity;
}

async function download(url) {
  const remote = await safeRequest.openRemote(url, {
    accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1',
    userAgent: 'Eniv emploi du temps',
    allowedTypes: ALLOWED_CONTENT_TYPES,
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    deadlineMs: DEADLINE_MS,
    label: "la source de l'emploi du temps"
  });

  const body = await safeRequest.readLimited(remote.stream, MAX_BYTES);
  return parseIcs(body.toString('utf8'));
}

/**
 * Fetches the calendar and updates the kept version. On failure, the previous
 * version is served if there is one.
 *
 * - A struggling source may answer an empty calendar: it must not clear a
 *   timetable that had lessons.
 * - The update is filtered on the url: if the admin changed the link meanwhile,
 *   the old calendar is not written over the new one.
 */
async function refresh(row) {
  const previous = parseStored(row.evenements);

  try {
    const events = await download(row.url);

    if (!events.length && previous?.length) {
      throw new IcsError('La source a renvoyé un calendrier vide');
    }

    const at = new Date();
    await db.run(
      `UPDATE emploi_temps_ics
       SET evenements = ?, fetched_at = ?, last_attempt_at = ?, last_error = NULL
       WHERE classe_id = ? AND url = ?`,
      [JSON.stringify(events), at, at, row.classe_id, row.url]
    );

    return present({ ...row, fetched_at: at, last_error: null }, events);
  } catch (error) {
    const known = error instanceof safeRequest.ProxyError || error instanceof IcsError;
    if (!known) console.error(`Timetable (class ${row.classe_id}):`, error);

    const message = (known ? error.message : "Impossible de récupérer l'emploi du temps").slice(0, 255);

    await db.run(
      'UPDATE emploi_temps_ics SET last_attempt_at = ?, last_error = ? WHERE classe_id = ? AND url = ?',
      [new Date(), message, row.classe_id, row.url]
    );

    if (previous) return present({ ...row, last_error: message }, previous);
    throw new safeRequest.ProxyError(message, 502);
  }
}

/**
 * Timetable of a class, from the kept version or the source. After a failure,
 * the kept version is returned without waiting for the source, even when stale (a
 * failing source can take DEADLINE_MS to fail again); the source is asked again in
 * the background once RETRY_MS has passed.
 * @param {number|null} classId
 * @param {object} [options]
 * @param {boolean} [options.force] - fetch the source even if the kept version is recent
 * @returns {Promise<{configure: false}|{configure: true, evenements: Array, misAJour: string|null, horsLigne: boolean, erreur?: string}>}
 * @throws {ProxyError} source unreachable and no kept version
 */
async function getTimetable(classId, { force = false } = {}) {
  if (!classId) return { configure: false };

  const row = await db.get('SELECT * FROM emploi_temps_ics WHERE classe_id = ?', [classId]);
  if (!row) return { configure: false };

  if (!force) {
    const stored = parseStored(row.evenements);

    if (stored && !row.last_error && age(row.fetched_at) < FRESH_MS) {
      return present(row, stored);
    }

    if (row.last_error && stored) {
      if (age(row.last_attempt_at) >= RETRY_MS) {
        startRefresh(row).catch(error => {
          console.error(`Timetable (class ${classId}):`, error);
        });
      }
      return present(row, stored);
    }

    if (row.last_error && age(row.last_attempt_at) < RETRY_MS) {
      throw new safeRequest.ProxyError(row.last_error, 502);
    }
  }

  return startRefresh(row);
}

/** Starts the fetch, or returns the one already in progress for this class. */
function startRefresh(row) {
  const classId = row.classe_id;
  if (!inFlight.has(classId)) {
    inFlight.set(classId, refresh(row).finally(() => inFlight.delete(classId)));
  }
  return inFlight.get(classId);
}

/**
 * Refreshes the timetable of every class that has an ICS link, one after the
 * other. A failure does not stop the next ones.
 * @param {object} [options]
 * @param {number} [options.pauseMs] - pause between two classes
 * @returns {Promise<{ok: number, failed: number}>}
 */
async function refreshAll({ pauseMs = REFRESH_PAUSE_MS } = {}) {
  const rows = await db.all('SELECT classe_id FROM emploi_temps_ics');
  let ok = 0;
  let failed = 0;

  for (const [index, { classe_id: classId }] of rows.entries()) {
    if (index && pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));

    try {
      const result = await getTimetable(classId, { force: true });
      if (result.horsLigne) {
        failed++;
        console.warn(`Timetable (class ${classId}): ${result.erreur}, previous version kept`);
      } else {
        ok++;
      }
    } catch (error) {
      failed++;
      console.warn(`Timetable (class ${classId}): ${error.message}`);
    }
  }

  return { ok, failed };
}

module.exports = { getTimetable, getSource, setSource, refreshAll, FRESH_MS, RETRY_MS };
