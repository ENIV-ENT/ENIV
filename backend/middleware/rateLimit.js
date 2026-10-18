const { rateLimit } = require('express-rate-limit');

// Limites de débit des routes publiques sensibles (connexion, inscription...).
//
// L'adresse IP vient de req.ip : derrière Caddy, server.js règle « trust proxy »
// pour lire X-Forwarded-For, sinon tous les visiteurs partageraient la même IP.
// Le registre est en mémoire : il suppose un unique processus Node, comme le
// service temps réel.

function limiter({ windowMinutes, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
  });
}

// Connexion : seuls les échecs comptent, un élève qui se reconnecte souvent
// n'est jamais bloqué.
const loginLimiter = limiter({
  windowMinutes: 15,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
});

// Création de comptes et demandes d'établissement
const signupLimiter = limiter({
  windowMinutes: 60,
  limit: 10,
  message: 'Trop de demandes. Réessayez dans une heure.',
});

// Vérification de disponibilité d'un identifiant (appelée à la frappe)
const lookupLimiter = limiter({
  windowMinutes: 15,
  limit: 100,
  message: 'Trop de requêtes. Réessayez dans quelques minutes.',
});

module.exports = { loginLimiter, signupLimiter, lookupLimiter };
