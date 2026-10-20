// Requête HTTP sortante vers une URL fournie par un utilisateur.
//
// Utilisée par le proxy d'images et par l'import d'emploi du temps ICS.
//
// Une URL arbitraire récupérée par le serveur est une cible SSRF classique :
// sans garde-fou, une URL pointant vers 127.0.0.1 ou vers les métadonnées cloud
// (169.254.169.254) permettrait de lire des ressources internes au serveur.

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

// Plages que le serveur ne doit jamais atteindre : boucle locale, réseaux privés,
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
 * Vérifie qu'une URL est acceptable comme cible d'une requête sortante.
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
 * Ouvre la requête vers la cible et valide sa réponse.
 * @param {URL} url - Cible déjà validée
 * @param {object} options - Voir openRemote
 * @param {number} redirectsLeft - Redirections encore autorisées
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 */
function request(url, options, redirectsLeft) {
  const { accept, userAgent, allowedTypes, maxBytes, timeoutMs, label } = options;

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;

    // Aucun en-tête du client n'est transmis : ni cookie, ni Referer, ni son User-Agent.
    // identity évite une compression qui rendrait Content-Length incohérent.
    const req = client.request(url, {
      lookup: safeLookup,
      timeout: timeoutMs,
      headers: {
        Accept: accept,
        'Accept-Encoding': 'identity',
        'User-Agent': userAgent
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

        return request(target, options, redirectsLeft - 1).then(resolve, reject);
      }

      if (statusCode !== 200) {
        response.resume();
        return reject(new ProxyError(`${capitalize(label)} a répondu ${statusCode}`, 502));
      }

      const contentType = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!allowedTypes.has(contentType)) {
        response.destroy();
        return reject(new ProxyError(`Type de contenu refusé : ${contentType || 'inconnu'}`, 415));
      }

      const contentLength = Number(headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.destroy();
        return reject(new ProxyError('Contenu trop volumineux', 413));
      }

      resolve({
        contentType,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        stream: response
      });
    });

    req.on('timeout', () => {
      req.destroy(new ProxyError(`${capitalize(label)} ne répond pas`, 504));
    });

    req.on('error', error => {
      reject(error instanceof ProxyError
        ? error
        : new ProxyError(`Impossible de joindre ${label}`, 502));
    });

    req.end();
  });
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Prépare une URL fournie par un utilisateur : analyse, nettoyage, validation.
 * @param {string} rawUrl - URL absolue http(s)
 * @returns {URL}
 * @throws {ProxyError} URL invalide ou refusée
 */
function prepareUrl(rawUrl) {
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

  return validateTarget(url);
}

/**
 * Ouvre une ressource distante en appliquant les protections SSRF.
 * @param {string} rawUrl - URL absolue http(s)
 * @param {object} options
 * @param {string} options.accept - En-tête Accept envoyé
 * @param {string} options.userAgent - En-tête User-Agent envoyé
 * @param {Set<string>} options.allowedTypes - Types de contenu acceptés
 * @param {number} options.maxBytes - Taille maximale annoncée par Content-Length
 * @param {number} [options.timeoutMs] - Délai d'inactivité du socket
 * @param {string} options.label - Désignation de la cible dans les messages d'erreur
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 * @throws {ProxyError} URL refusée, hôte injoignable ou réponse inexploitable
 */
async function openRemote(rawUrl, options) {
  return request(prepareUrl(rawUrl), { timeoutMs: DEFAULT_TIMEOUT_MS, ...options }, MAX_REDIRECTS);
}

/**
 * Lit entièrement un flux en refusant de dépasser une taille donnée.
 * Content-Length est déclaratif : les octets reçus sont recomptés.
 * @param {import('stream').Readable} stream
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function readLimited(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;

    stream.on('data', chunk => {
      received += chunk.length;
      if (received > maxBytes) {
        stream.destroy();
        return reject(new ProxyError('Contenu trop volumineux', 413));
      }
      chunks.push(chunk);
    });

    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', () => reject(new ProxyError('Réception interrompue', 502)));
  });
}

module.exports = { openRemote, readLimited, prepareUrl, validateTarget, ProxyError };
