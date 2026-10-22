/**
 * Fetches a remote image on behalf of the browser.
 *
 * Goal: the student never contacts the image host, so their IP address (and
 * User-Agent, Referer...) does not leak to a third party.
 *
 * The SSRF protections (forbidden addresses, revalidated redirects...) are in
 * safeRequest.js.
 * @module
 */

const { openRemote, ProxyError } = require('./safeRequest');

/**
 * Raster images only. SVG is excluded on purpose: it can embed scripts and
 * would be served from our own domain.
 */
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
 * Fetches a remote image.
 * @param {string} rawUrl - absolute http(s) URL of the image
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 * @throws {ProxyError} URL refused, host unreachable or unusable response
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
