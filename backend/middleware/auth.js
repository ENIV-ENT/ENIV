const jwt = require('jsonwebtoken');
const db = require("../models/dbHelper");

const { JWT_SECRET } = require('../config/jwt');
const LAST_LOGIN_THROTTLE_MS = 5 * 60 * 1000;

// Helper pour extraire et vérifier le token
const verifyToken = async (req) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  let tokenPayload;

  try {
    tokenPayload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
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

function authChecker(predicate, errorMessage) {
  return async (req, res, next) => {
    const user = await verifyToken(req);

    if (!user) {
      return res.status(401).json({error: 'Non authentifié'});
    }

    if (!predicate(user)) {
      return res.status(403).json({error: errorMessage});
    }

    // Attacher les infos user à req pour les utiliser dans les routes
    req.user = user;
    // Créer un objet session compatible avec le code existant
    req.session = {
      userId: user.id,
      username: user.username,
      role: user.role,
      // Ajouter les méthodes stub pour éviter les erreurs
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
const requireEleve = authChecker((user) => user.role === "eleve", "Accès refusé - Élève requis");
const requireSuperAdmin = authChecker((user) => user.role === "superadmin", "Accès refusé - SuperAdmin requis");
const requireAdminOrSuperAdmin = authChecker((user) => user.role === "admin" || user.role === "superadmin", "Accès refusé");

module.exports = {verifyToken, requireAuth, requireAdmin, requireEleve, requireSuperAdmin, requireAdminOrSuperAdmin};