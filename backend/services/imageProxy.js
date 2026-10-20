// Récupération d'une image distante pour le compte du navigateur.
//
// Objectif : l'élève ne contacte jamais l'hébergeur de l'image, son adresse IP
// (et son User-Agent, son Referer...) ne fuite donc pas vers un tiers.
//
// Les protections SSRF (adresses interdites, redirections revalidées...) sont
// dans safeRequest.js.

const { openRemote, ProxyError } = require('./safeRequest');

// Uniquement des images matricielles. Le SVG est volontairement exclu : il peut
// embarquer du script et serait servi depuis notre propre domaine.
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon'
]);

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Récupère une image distante.
 * @param {string} rawUrl - URL absolue http(s) de l'image
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 * @throws {ProxyError} URL refusée, hôte injoignable ou réponse inexploitable
 */
function fetchImage(rawUrl) {
  return openRemote(rawUrl, {
    accept: 'image/*',
    userAgent: 'Eniv image proxy',
    allowedTypes: ALLOWED_CONTENT_TYPES,
    maxBytes: MAX_BYTES,
    label: "l'hébergeur de l'image"
  });
}

module.exports = { fetchImage, ProxyError, MAX_BYTES };
