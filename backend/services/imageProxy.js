// Récupération d'une image distante pour le compte du navigateur.
//
// Objectif : l'élève ne contacte jamais l'hébergeur de l'image, son adresse IP
// (et son User-Agent, son Referer...) ne fuite donc pas vers un tiers.
//
// Un proxy sortant est une cible SSRF classique : sans garde-fou, une URL
// pointant vers 127.0.0.1 ou vers les métadonnées cloud (169.254.169.254)
// permettrait de lire des ressources internes au serveur.

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

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

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

// Plages que le proxy ne doit jamais atteindre : boucle locale, réseaux privés,
// link-local (métadonnées cloud), partagées, multicast et réservées.
const BLOCKED_ADDRESSES = new net.BlockList();

BLOCKED_ADDRESSES.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('192.0.0.0', 24, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('198.18.0.0', 15, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('224.0.0.0', 4, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('240.0.0.0', 4, 'ipv4');
BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('ff00::', 8, 'ipv6');

/**
 * Erreur portant le code HTTP à renvoyer au client.
 */
class ProxyError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
  }
}

// net.BlockList reconnaît nativement les adresses IPv6 mappées (::ffff:10.0.0.1)
function isBlockedAddress(address, family) {
  return BLOCKED_ADDRESSES.check(address, family);
}

/**
 * Extrait l'adresse IP d'un hôte quand celle-ci est écrite en clair dans l'URL.
 * @param {string} hostname - Hôte tel que fourni par URL (IPv6 entre crochets)
 * @returns {{address: string, family: string}|null} Null si l'hôte est un nom de domaine
 */
function parseLiteralAddress(hostname) {
  const address = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const version = net.isIP(address);
  if (!version) return null;

  return { address, family: version === 6 ? 'ipv6' : 'ipv4' };
}

/**
 * Résolution DNS filtrée, utilisée par http.request.
 * Le contrôle a lieu au moment de la résolution : le socket se connecte à
 * l'adresse que nous renvoyons, un DNS rebinding ne peut donc pas la remplacer.
 */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);

    const allowed = addresses.filter(
      ({ address, family }) => !isBlockedAddress(address, family === 6 ? 'ipv6' : 'ipv4')
    );

    if (!allowed.length) {
      return callback(new ProxyError('Adresse de destination interdite', 403));
    }

    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
}

/**
 * Vérifie qu'une URL est acceptable comme cible du proxy.
 * @param {URL} url - URL à contrôler
 * @returns {URL} La même URL
 * @throws {ProxyError} Si le schéma ou l'adresse est refusé
 */
function validateTarget(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError('Seules les URL http et https sont acceptées', 400);
  }

  // Une IP écrite en clair court-circuite safeLookup : Node ne résout pas un
  // hôte qui est déjà une adresse. Ce cas doit donc être filtré ici.
  const literal = parseLiteralAddress(url.hostname);
  if (literal && isBlockedAddress(literal.address, literal.family)) {
    throw new ProxyError('Adresse de destination interdite', 403);
  }

  return url;
}

/**
 * Ouvre la requête vers l'hébergeur et valide sa réponse.
 * @param {URL} url - Cible déjà validée
 * @param {number} redirectsLeft - Redirections encore autorisées
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 */
function requestImage(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;

    // Aucun en-tête du client n'est transmis : ni cookie, ni Referer, ni son User-Agent.
    // identity évite une compression qui rendrait Content-Length incohérent.
    const request = client.request(url, {
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: {
        Accept: 'image/*',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Eniv image proxy'
      }
    }, response => {
      const { statusCode, headers } = response;

      if (REDIRECT_STATUS.has(statusCode) && headers.location) {
        response.resume();

        if (!redirectsLeft) {
          return reject(new ProxyError('Trop de redirections', 502));
        }

        // Chaque étape est revalidée : une redirection vers 127.0.0.1 est refusée
        let target;
        try {
          target = validateTarget(new URL(headers.location, url));
        } catch (error) {
          return reject(error);
        }

        return requestImage(target, redirectsLeft - 1).then(resolve, reject);
      }

      if (statusCode !== 200) {
        response.resume();
        return reject(new ProxyError(`L'hébergeur de l'image a répondu ${statusCode}`, 502));
      }

      const contentType = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        response.destroy();
        return reject(new ProxyError(`Type de contenu refusé : ${contentType || 'inconnu'}`, 415));
      }

      const contentLength = Number(headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
        response.destroy();
        return reject(new ProxyError('Image trop volumineuse', 413));
      }

      resolve({
        contentType,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        stream: response
      });
    });

    request.on('timeout', () => {
      request.destroy(new ProxyError("L'hébergeur de l'image ne répond pas", 504));
    });

    request.on('error', error => {
      reject(error instanceof ProxyError
        ? error
        : new ProxyError("Impossible de joindre l'hébergeur de l'image", 502));
    });

    request.end();
  });
}

/**
 * Récupère une image distante.
 * @param {string} rawUrl - URL absolue http(s) de l'image
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 * @throws {ProxyError} URL refusée, hôte injoignable ou réponse inexploitable
 */
async function fetchImage(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProxyError('URL invalide', 400);
  }

  // Les identifiants d'une URL ne servent qu'à faire tester des accès par le serveur
  url.username = '';
  url.password = '';
  url.hash = '';

  return requestImage(validateTarget(url), MAX_REDIRECTS);
}

module.exports = { fetchImage, ProxyError, MAX_BYTES };
