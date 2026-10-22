const crypto = require('crypto');

/**
 * Temporary links to the files attached to assignments.
 *
 * The browser cannot attach the login token (Authorization header) to a plain
 * link or to window.open: the page therefore asks for a signed link, valid for a
 * few minutes, then opens it. Only a member of the assignment's class can get
 * that link (see GET /api/devoirs/fichiers/:id/lien).
 *
 * The signing key is drawn at random on startup: a restart only invalidates the
 * pending links, which are asked again in one click.
 * @module
 */

const LINK_TTL_MS = 5 * 60 * 1000;
const SIGNING_KEY = crypto.randomBytes(32);

function sign(payload) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest('base64url');
}

/** Token "<id>.<expiry>.<signature>" giving access to the file for LINK_TTL_MS. */
function createFileToken(fileId, now = Date.now()) {
  const payload = `${Number(fileId)}.${now + LINK_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** @returns {number|null} the file id if the token is authentic and not expired */
function readFileToken(token, now = Date.now()) {
  const match = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!match) return null;

  const [, fileId, expiresAt, signature] = match;
  const expected = Buffer.from(sign(`${fileId}.${expiresAt}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  if (Number(expiresAt) < now) return null;

  return Number(fileId);
}

module.exports = { createFileToken, readFileToken, LINK_TTL_MS };
