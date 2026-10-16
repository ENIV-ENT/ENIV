const crypto = require('crypto');
const db = require('../models/dbHelper');

/**
 * Jetons d'accès au serveur MCP (/api/mcp).
 *
 * Un utilisateur peut avoir plusieurs jetons, chacun nommé et éventuellement
 * limité dans le temps. Le jeton n'est montré qu'une fois, à sa création :
 * seule son empreinte SHA-256 est stockée.
 */

const TOKEN_PREFIX = 'eniv_';
const LAST_USED_THROTTLE_MINUTES = 5;
const MAX_TOKENS_PER_USER = 10;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function listTokens(userId) {
  return db.all(
    `SELECT id, nom, created_at, last_used_at, expires_at,
            (expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP()) AS expired
     FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    [userId]
  );
}

async function countTokens(userId) {
  const row = await db.get('SELECT COUNT(*) AS count FROM mcp_tokens WHERE user_id = ?', [userId]);
  return Number(row.count);
}

/**
 * @param {number} userId
 * @param {{nom: string, expiresAt: string|null}} options - expiresAt : 'YYYY-MM-DD HH:MM:SS' UTC
 * @returns {Promise<{id: number, token: string}>}
 */
async function createToken(userId, { nom, expiresAt }) {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const result = await db.run(
    'INSERT INTO mcp_tokens (user_id, nom, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [userId, nom, hashToken(token), expiresAt]
  );
  return { id: result.lastInsertRowid, token };
}

async function updateToken(userId, id, { nom, expiresAt }) {
  const result = await db.run(
    'UPDATE mcp_tokens SET nom = ?, expires_at = ? WHERE id = ? AND user_id = ?',
    [nom, expiresAt, id, userId]
  );
  return result.affectedRows > 0;
}

async function revokeToken(userId, id) {
  const result = await db.run('DELETE FROM mcp_tokens WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

/**
 * Retrouve l'utilisateur propriétaire d'un jeton valide (connu et non expiré), ou null.
 * @param {string} token
 * @returns {Promise<Object|null>}
 */
async function findUserByToken(token) {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null;

  const row = await db.get(
    `SELECT t.id AS token_id, u.*
     FROM mcp_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND (t.expires_at IS NULL OR t.expires_at > UTC_TIMESTAMP())`,
    [hashToken(token)]
  );
  if (!row) return null;

  db.run(
    `UPDATE mcp_tokens SET last_used_at = UTC_TIMESTAMP()
     WHERE id = ? AND (last_used_at IS NULL OR last_used_at < UTC_TIMESTAMP() - INTERVAL ${LAST_USED_THROTTLE_MINUTES} MINUTE)`,
    [row.token_id]
  ).catch(() => {});

  const { token_id, ...user } = row;
  return user;
}

module.exports = {
  MAX_TOKENS_PER_USER,
  listTokens,
  countTokens,
  createToken,
  updateToken,
  revokeToken,
  findUserByToken
};
