const crypto = require('crypto');

/**
 * Liens temporaires vers les documents joints aux devoirs.
 *
 * Le navigateur ne peut pas joindre le jeton de connexion (en-tête
 * Authorization) à un simple lien ou à window.open : la page demande donc un
 * lien signé, valable quelques minutes, puis l'ouvre. Seul un membre de la
 * classe du devoir peut obtenir ce lien (voir GET /api/devoirs/fichiers/:id/lien).
 *
 * La clé de signature est tirée au hasard au démarrage : un redémarrage
 * invalide seulement les liens en cours, qui se redemandent d'un clic.
 */

const LINK_TTL_MS = 5 * 60 * 1000;
const SIGNING_KEY = crypto.randomBytes(32);

function sign(payload) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest('base64url');
}

/** Jeton « <id>.<expiration>.<signature> » donnant accès au fichier pendant LINK_TTL_MS. */
function creerJeton(fichierId, now = Date.now()) {
  const payload = `${Number(fichierId)}.${now + LINK_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** @returns {number|null} identifiant du fichier si le jeton est authentique et non expiré */
function lireJeton(token, now = Date.now()) {
  const match = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!match) return null;

  const [, fichierId, expiresAt, signature] = match;
  const expected = Buffer.from(sign(`${fichierId}.${expiresAt}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  if (Number(expiresAt) < now) return null;

  return Number(fichierId);
}

module.exports = { creerJeton, lireJeton, LINK_TTL_MS };
