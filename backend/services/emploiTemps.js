// Emploi du temps d'une classe, importé depuis un lien ICS (ADE, Hyperplanning...).
//
// La dernière version récupérée avec succès est gardée en base
// (table emploi_temps_ics) : si la source tombe, c'est elle qui est servie,
// avec sa date de mise à jour. Le planificateur la rafraîchit régulièrement
// (refreshAll), les requêtes des utilisateurs ne la récupèrent elles-mêmes que
// si elle a vieilli.

const db = require('../models/dbHelper');
// Appelé via l'objet module pour que les tests puissent remplacer openRemote
const safeRequest = require('./safeRequest');
const { parseIcs, IcsError } = require('./icsParser');

// Au-delà, une lecture déclenche une nouvelle récupération
const FRESH_MS = 30 * 60 * 1000;
// Après un échec, on attend avant de réessayer : toute une classe qui ouvre la
// page pendant une panne ne doit pas solliciter la source à chaque fois
const RETRY_MS = 5 * 60 * 1000;
// Pause entre deux classes lors du rafraîchissement planifié
const REFRESH_PAUSE_MS = 2000;

const MAX_BYTES = 10 * 1024 * 1024;
// Inactivité du socket, puis durée maximale du téléchargement complet : une
// source qui envoie un octet de temps en temps ne doit pas bloquer
// refreshAll, qui traite les classes l'une après l'autre
const TIMEOUT_MS = 15000;
const DEADLINE_MS = 30000;

// Selon les serveurs, un .ics est servi sous l'un ou l'autre de ces types ;
// le contenu est de toute façon vérifié par parseIcs
const ALLOWED_CONTENT_TYPES = new Set([
  'text/calendar',
  'text/plain',
  'application/ics',
  'application/octet-stream'
]);

// Récupérations en cours, par classe : les lectures simultanées partagent la même
const inFlight = new Map();

/**
 * Lien ICS configuré pour une classe.
 * @param {number} classeId
 * @returns {Promise<string|null>}
 */
async function getSource(classeId) {
  const row = await db.get('SELECT url FROM emploi_temps_ics WHERE classe_id = ?', [classeId]);
  return row ? row.url : null;
}

/**
 * Enregistre le lien ICS d'une classe. Changer de lien efface la version gardée
 * de l'ancien ; un lien vide supprime la configuration.
 * @param {number} classeId
 * @param {string|null} url - Lien déjà validé
 */
async function setSource(classeId, url) {
  if (!url) {
    await db.run('DELETE FROM emploi_temps_ics WHERE classe_id = ?', [classeId]);
    return;
  }

  // MySQL évalue les affectations dans l'ordre : url doit être mise à jour en
  // dernier pour que les comparaisons portent sur l'ancien lien
  await db.run(
    `INSERT INTO emploi_temps_ics (classe_id, url) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       evenements = IF(url = VALUES(url), evenements, NULL),
       fetched_at = IF(url = VALUES(url), fetched_at, NULL),
       last_attempt_at = IF(url = VALUES(url), last_attempt_at, NULL),
       last_error = IF(url = VALUES(url), last_error, NULL),
       url = VALUES(url)`,
    [classeId, url]
  );
}

function parseStored(evenements) {
  if (evenements == null) return null;
  return typeof evenements === 'string' ? JSON.parse(evenements) : evenements;
}

function present(row, evenements) {
  return {
    configure: true,
    evenements,
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
 * Récupère le calendrier et met à jour la version gardée. En cas d'échec, la
 * version précédente est servie si elle existe.
 */
async function refresh(row) {
  const previous = parseStored(row.evenements);

  try {
    const evenements = await download(row.url);

    // Une source en difficulté peut répondre un calendrier vide : il ne doit pas
    // effacer un emploi du temps qui contenait des cours
    if (!evenements.length && previous?.length) {
      throw new IcsError('La source a renvoyé un calendrier vide');
    }

    const at = new Date();
    // Filtré sur l'url : si l'admin a changé de lien entre-temps, l'ancien
    // calendrier n'est pas écrit sur le nouveau
    await db.run(
      `UPDATE emploi_temps_ics
       SET evenements = ?, fetched_at = ?, last_attempt_at = ?, last_error = NULL
       WHERE classe_id = ? AND url = ?`,
      [JSON.stringify(evenements), at, at, row.classe_id, row.url]
    );

    return present({ ...row, fetched_at: at, last_error: null }, evenements);
  } catch (error) {
    const known = error instanceof safeRequest.ProxyError || error instanceof IcsError;
    if (!known) console.error(`Emploi du temps (classe ${row.classe_id}) :`, error);

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
 * Emploi du temps d'une classe, depuis la version gardée ou la source.
 * @param {number|null} classeId
 * @param {object} [options]
 * @param {boolean} [options.force] - Récupère la source même si la version gardée est récente
 * @returns {Promise<{configure: false}|{configure: true, evenements: Array, misAJour: string|null, horsLigne: boolean, erreur?: string}>}
 * @throws {ProxyError} Source injoignable et aucune version gardée
 */
async function getEmploiTemps(classeId, { force = false } = {}) {
  if (!classeId) return { configure: false };

  const row = await db.get('SELECT * FROM emploi_temps_ics WHERE classe_id = ?', [classeId]);
  if (!row) return { configure: false };

  if (!force) {
    const stored = parseStored(row.evenements);

    if (stored && !row.last_error && age(row.fetched_at) < FRESH_MS) {
      return present(row, stored);
    }

    if (row.last_error && age(row.last_attempt_at) < RETRY_MS) {
      if (stored) return present(row, stored);
      throw new safeRequest.ProxyError(row.last_error, 502);
    }
  }

  if (!inFlight.has(classeId)) {
    inFlight.set(classeId, refresh(row).finally(() => inFlight.delete(classeId)));
  }
  return inFlight.get(classeId);
}

/**
 * Rafraîchit l'emploi du temps de toutes les classes qui ont un lien ICS,
 * l'une après l'autre. Un échec n'interrompt pas les suivantes.
 * @param {object} [options]
 * @param {number} [options.pauseMs] - Pause entre deux classes
 * @returns {Promise<{ok: number, echecs: number}>}
 */
async function refreshAll({ pauseMs = REFRESH_PAUSE_MS } = {}) {
  const rows = await db.all('SELECT classe_id FROM emploi_temps_ics');
  let ok = 0;
  let echecs = 0;

  for (const [index, { classe_id: classeId }] of rows.entries()) {
    if (index && pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));

    try {
      const result = await getEmploiTemps(classeId, { force: true });
      if (result.horsLigne) {
        echecs++;
        console.warn(`Emploi du temps (classe ${classeId}) : ${result.erreur}, version précédente conservée`);
      } else {
        ok++;
      }
    } catch (error) {
      echecs++;
      console.warn(`Emploi du temps (classe ${classeId}) : ${error.message}`);
    }
  }

  return { ok, echecs };
}

module.exports = { getEmploiTemps, getSource, setSource, refreshAll, FRESH_MS, RETRY_MS };
