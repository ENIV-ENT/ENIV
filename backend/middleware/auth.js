const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé - Admin requis' });
  }
  next();
};

const requireEleve = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'eleve') {
    return res.status(403).json({ error: 'Accès refusé - Élève requis' });
  }
  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès refusé - SuperAdmin requis' });
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireEleve, requireSuperAdmin };
