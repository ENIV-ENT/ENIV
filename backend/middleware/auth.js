const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Helper pour extraire et vérifier le token
const verifyToken = (req) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const requireAuth = (req, res, next) => {
  const user = verifyToken(req);

  if (!user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  // Attacher les infos user à req pour les utiliser dans les routes
  req.user = user;
  // Créer un objet session compatible avec le code existant
  req.session = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    // Ajouter les méthodes stub pour éviter les erreurs
    touch: () => {},
    regenerate: (cb) => cb && cb(),
    destroy: (cb) => cb && cb(),
    reload: (cb) => cb && cb(),
    save: (cb) => cb && cb(),
  };
  next();
};

const requireAdmin = (req, res, next) => {
  const user = verifyToken(req);

  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé - Admin requis' });
  }

  req.user = user;
  req.session = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    touch: () => {},
    regenerate: (cb) => cb && cb(),
    destroy: (cb) => cb && cb(),
    reload: (cb) => cb && cb(),
    save: (cb) => cb && cb(),
  };
  next();
};

const requireEleve = (req, res, next) => {
  const user = verifyToken(req);

  if (!user || user.role !== 'eleve') {
    return res.status(403).json({ error: 'Accès refusé - Élève requis' });
  }

  req.user = user;
  req.session = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    touch: () => {},
    regenerate: (cb) => cb && cb(),
    destroy: (cb) => cb && cb(),
    reload: (cb) => cb && cb(),
    save: (cb) => cb && cb(),
  };
  next();
};

const requireSuperAdmin = (req, res, next) => {
  const user = verifyToken(req);

  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès refusé - SuperAdmin requis' });
  }

  req.user = user;
  req.session = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    touch: () => {},
    regenerate: (cb) => cb && cb(),
    destroy: (cb) => cb && cb(),
    reload: (cb) => cb && cb(),
    save: (cb) => cb && cb(),
  };
  next();
};

module.exports = { requireAuth, requireAdmin, requireEleve, requireSuperAdmin };
