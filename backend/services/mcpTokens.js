const crypto = require('crypto');
const db = require('../models/dbHelper');

/**
 * Jetons d'accès au serveur MCP (/api/mcp).
 *
 * Le jeton n'est montré qu'une fois, à sa création : seule son empreinte SHA-256
 * est stockée. Un utilisateur a au plus un jeton ; en générer un nouveau
 * révoque l'ancien.
 */

const TOKEN_PREFIX = 'eniv_';
const LAST_USED_THROTTLE_MINUTES = 5;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createToken(userId) {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  await db.run(
    `INSERT INTO mcp_tokens (user_id, token_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), created_at = CURRENT_TIMESTAMP, last_used_at = NULL`,
    [userId, hashToken(token)]
  );
  return token;
}

async function revokeToken(userId) {
  await db.run('DELETE FROM mcp_tokens WHERE user_id = ?', [userId]);
}

async function getTokenInfo(userId) {
  return db.get('SELECT created_at, last_used_at FROM mcp_tokens WHERE user_id = ?', [userId]);
}

/**
 * Retrouve l'utilisateur propriétaire d'un jeton, ou null si le jeton est inconnu.
 * @param {string} token
 * @returns {Promise<Object|null>}
 */
async function findUserByToken(token) {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null;

  const row = await db.get(
    `SELECT t.id AS token_id, u.*
     FROM mcp_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`,
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

module.exports = { createToken, revokeToken, getTokenInfo, findUserByToken };
