// Secret de signature des jetons de connexion.
//
// Sans JWT_SECRET, n'importe qui pourrait signer un jeton valide avec la valeur
// par défaut publiée dans le dépôt : en production, le serveur refuse de démarrer.
// En développement et en test, une valeur fixe évite toute configuration.

const DEV_SECRET = 'dev-jwt-secret-not-for-production';
const RECOMMENDED_LENGTH = 32;
// Valeurs publiées dans le dépôt (ancien défaut, ancien .env.exemple,
// compose.yaml) : les accepter en production permettrait de forger n'importe
// quel jeton.
const PUBLIC_SECRETS = [
  'your-secret-key-change-in-production',
  'your-jwt-secret-key-change-in-production',
  DEV_SECRET,
];

function resolveJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET;
  const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  if (!secret) {
    if (isDev) return DEV_SECRET;
    throw new Error('JWT_SECRET manquant. Générez-en un avec : openssl rand -hex 48');
  }
  if (PUBLIC_SECRETS.includes(secret) && !isDev) {
    throw new Error('JWT_SECRET est une valeur d\'exemple publique. Générez-en un avec : openssl rand -hex 48');
  }

  // Un secret court reste accepté pour ne pas couper une production existante,
  // mais il est signalé à chaque démarrage.
  if (secret.length < RECOMMENDED_LENGTH && !isDev) {
    console.warn(`⚠ JWT_SECRET fait moins de ${RECOMMENDED_LENGTH} caractères : pensez à le renforcer (openssl rand -hex 48).`);
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
