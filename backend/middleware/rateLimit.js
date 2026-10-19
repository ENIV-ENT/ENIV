const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Limites de débit des routes publiques sensibles (connexion, inscription...).
//
// L'adresse IP vient de req.ip : derrière Caddy, server.js règle « trust proxy »
// pour lire X-Forwarded-For, sinon tous les visiteurs partageraient la même IP.
// Le registre est en mémoire : il suppose un unique processus Node, comme le
// service temps réel.
//
// Tout un établissement sort souvent par la même IP publique : les plafonds par IP seule sont donc larges, pour ne pas bloquer une classe entière.

function limiter({ windowMinutes, limit, message, skipSuccessfulRequests = false, keyGenerator }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    skipSuccessfulRequests,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
  });
}

// Connexion : seuls les échecs comptent, un élève qui se reconnecte souvent
// n'est jamais bloqué. Les échecs sont comptés par IP + identifiant (les fautes de frappe d'un élève ne bloquent pas ses voisins), avec un plafond large par IP seule contre l'essai de nombreux identifiants.
const loginMessage = 'Trop de tentatives de connexion. Réessayez dans 15 minutes.';
const loginLimiter = [
  limiter({
    windowMinutes: 15,
    limit: 100,
    skipSuccessfulRequests: true,
    message: loginMessage,
  }),
  limiter({
    windowMinutes: 15,
    limit: 10,
    skipSuccessfulRequests: true,
    // Minuscules : la connexion ignore la casse de l'identifiant
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username ?? '').toLowerCase()}`,
    message: loginMessage,
  }),
];

// Création de comptes et demandes d'établissement
const signupLimiter = limiter({
  windowMinutes: 60,
  limit: 200,
  message: 'Trop de demandes. Réessayez dans une heure.',
});

// Vérification de disponibilité d'un identifiant (appelée à la frappe)
const lookupLimiter = limiter({
  windowMinutes: 15,
  limit: 1000,
  message: 'Trop de requêtes. Réessayez dans quelques minutes.',
});

module.exports = { loginLimiter, signupLimiter, lookupLimiter };
