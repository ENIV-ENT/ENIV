/**
 * Rate limits of the sensitive public routes (login, signup...).
 *
 * The IP address comes from req.ip: behind Caddy, server.js sets "trust proxy"
 * to read X-Forwarded-For, otherwise every visitor would share the same IP.
 * The store is in memory: it assumes a single Node process, like the realtime
 * service.
 *
 * A whole school often goes out through the same public IP, so the limits per
 * IP alone are generous, so as not to block an entire class.
 * @module
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function limiter({ windowMinutes, message, ...options }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
    ...options,
  });
}

const loginOptions = {
  windowMinutes: 15,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
};

/**
 * Login: only wrong credentials (401) count, so a student who logs in often is
 * never blocked, nor a class during an outage (500). Failures are counted per
 * IP + username (lowercased, as login ignores the username case), so a student's
 * typos do not block their neighbors, with a generous limit per IP alone against
 * trying many usernames.
 */
const loginLimiter = [
  limiter({ ...loginOptions, limit: 100 }),
  limiter({
    ...loginOptions,
    limit: 10,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username ?? '').toLowerCase()}`,
  }),
];

/** Account creation and school requests. */
const signupLimiter = limiter({
  windowMinutes: 60,
  limit: 200,
  message: 'Trop de demandes. Réessayez dans une heure.',
});

/** Username availability check, called while typing. */
const lookupLimiter = limiter({
  windowMinutes: 15,
  limit: 1000,
  message: 'Trop de requêtes. Réessayez dans quelques minutes.',
});

/**
 * Comments: each one reloads the assignments of the whole class in real time.
 * Counted per account (authenticated route), not per shared IP.
 */
const commentLimiter = limiter({
  windowMinutes: 1,
  limit: 10,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'Trop de commentaires envoyés. Réessayez dans une minute.',
});

module.exports = { loginLimiter, signupLimiter, lookupLimiter, commentLimiter };
