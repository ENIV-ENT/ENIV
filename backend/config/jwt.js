/**
 * Signing secret of the login tokens.
 *
 * Without JWT_SECRET, anyone could sign a valid token with the default value
 * published in the repository: in production, the server refuses to start.
 * In development and tests, a fixed value avoids any setup.
 * @module
 */

const DEV_SECRET = 'dev-jwt-secret-not-for-production';
const RECOMMENDED_LENGTH = 32;

/**
 * Values published in the repository (old default, old sample .env,
 * compose.yaml): accepting them in production would allow forging any token.
 */
const PUBLIC_SECRETS = [
  'your-secret-key-change-in-production',
  'your-jwt-secret-key-change-in-production',
  DEV_SECRET,
];

/**
 * Returns the secret to use, or throws when it is missing or public in production.
 * A short secret is still accepted so as not to break an existing production,
 * but it is reported on every startup.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET;
  const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  if (!secret) {
    if (isDev) return DEV_SECRET;
    throw new Error('JWT_SECRET is missing. Generate one with: openssl rand -hex 48');
  }
  if (PUBLIC_SECRETS.includes(secret) && !isDev) {
    throw new Error('JWT_SECRET is a public sample value. Generate one with: openssl rand -hex 48');
  }

  if (secret.length < RECOMMENDED_LENGTH && !isDev) {
    console.warn(`⚠ JWT_SECRET is shorter than ${RECOMMENDED_LENGTH} characters: consider strengthening it (openssl rand -hex 48).`);
  }
  return secret;
}

let JWT_SECRET;
try {
  JWT_SECRET = resolveJwtSecret();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

module.exports = { JWT_SECRET, resolveJwtSecret };
