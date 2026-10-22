const jwt = require('jsonwebtoken');
const db = require("../models/dbHelper");

const { JWT_SECRET } = require('../config/jwt');
const LAST_LOGIN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Reads the Bearer token of the request and returns the matching user, or null.
 * Also refreshes users.last_login_at, at most every LAST_LOGIN_THROTTLE_MS.
 * @param {import('express').Request} req
 * @returns {Promise<Object|null>}
 */
const verifyToken = async (req) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  let tokenPayload;

  try {
    tokenPayload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }

  const user = await db.get(
    'SELECT * FROM users WHERE id = ?',
    [tokenPayload.userId]
  );
  if (!user) {
    return null;
  }

  const lastLoginAt = user.last_login_at ? new Date(user.last_login_at).getTime() : 0;
  if (Date.now() - lastLoginAt > LAST_LOGIN_THROTTLE_MS) {
    db.run('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]).catch(() => {});
  }

  return user;
};

/**
 * Builds a middleware that requires an authenticated user matching `predicate`.
 * It sets req.user, and req.session as a stub kept for older route code.
 * @param {(user: Object) => boolean} predicate
 * @param {string} errorMessage - sent with the 403 response
 */
function authChecker(predicate, errorMessage) {
  return async (req, res, next) => {
    const user = await verifyToken(req);

    if (!user) {
      return res.status(401).json({error: 'Non authentifié'});
    }

    if (!predicate(user)) {
      return res.status(403).json({error: errorMessage});
    }

    req.user = user;
    req.session = {
      userId: user.id,
      username: user.username,
      role: user.role,
      touch: () => {
      },
      regenerate: (cb) => cb && cb(),
      destroy: (cb) => cb && cb(),
      reload: (cb) => cb && cb(),
      save: (cb) => cb && cb(),
    };
    await next();
  }
}

const requireAuth = authChecker(() => true, "Non authentifié");
const requireAdmin = authChecker((user) => user.role === "admin", "Accès refusé - Admin requis");
const requireStudent = authChecker((user) => user.role === "eleve", "Accès refusé - Élève requis");
const requireSuperAdmin = authChecker((user) => user.role === "superadmin", "Accès refusé - SuperAdmin requis");
const requireAdminOrSuperAdmin = authChecker((user) => user.role === "admin" || user.role === "superadmin", "Accès refusé");

module.exports = {verifyToken, requireAuth, requireAdmin, requireStudent, requireSuperAdmin, requireAdminOrSuperAdmin};