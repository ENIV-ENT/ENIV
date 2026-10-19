const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Limites de débit des routes publiques sensibles (connexion, inscription...).
//
// L'adresse IP vient de req.ip : derrière Caddy, server.js règle « trust proxy »
// pour lire X-Forwarded-For, sinon tous les visiteurs partageraient la même IP.
// Le registre est en mémoire : il suppose un unique processus Node, comme le
// service temps réel.
//
// Tout un établissement sort souvent par la même IP publique : les plafonds par
// IP seule sont donc larges, pour ne pas bloquer une classe entière.

function limiter({ windowMinutes, message, ...options }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
    ...options,
  });
}

// Connexion : seuls les mauvais identifiants (401) comptent. Un élève qui se
// reconnecte souvent n'est jamais bloqué, ni une classe pendant une panne (500).
// Les échecs sont comptés par IP + identifiant, pour que les fautes de frappe
// d'un élève ne bloquent pas ses voisins, avec un plafond large par IP seule
// contre l'essai de nombreux identifiants.
const loginOptions = {
  windowMinutes: 15,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
};
const loginLimiter = [
  limiter({ ...loginOptions, limit: 100 }),
  limiter({
    ...loginOptions,
    limit: 10,
    // Minuscules : la connexion ignore la casse de l'identifiant
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username ?? '').toLowerCase()}`,
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
