/**
 * Outgoing HTTP request to a URL given by a user.
 *
 * Used by the image proxy and by the ICS timetable import.
 *
 * An arbitrary URL fetched by the server is a classic SSRF target: without
 * safeguards, a URL pointing to 127.0.0.1 or to the cloud metadata
 * (169.254.169.254) would allow reading resources internal to the server.
 *
 * The error messages are in French: they are shown to the user.
 * @module
 */

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

/**
 * Ranges the server must never reach: loopback, private networks, link-local
 * (cloud metadata), shared, multicast and reserved.
 */
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
 * Error carrying the HTTP status to send back to the client.
 */
class ProxyError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
  }
}

/** net.BlockList natively recognizes mapped IPv6 addresses (::ffff:10.0.0.1). */
function isBlockedAddress(address, family) {
  return BLOCKED_ADDRESSES.check(address, family);
}

/**
 * Extracts the IP address of a host when it is written as is in the URL.
 * @param {string} hostname - host as given by URL (IPv6 between brackets)
 * @returns {{address: string, family: string}|null} null if the host is a domain name
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
 * Filtered DNS resolution, used by http.request.
 * The check happens at resolution time: the socket connects to the address we
 * return, so a DNS rebinding cannot replace it.
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
 * Checks that a URL is acceptable as the target of an outgoing request.
 * An IP written as is bypasses safeLookup (Node does not resolve a host that is
 * already an address), so that case is filtered here.
 * @param {URL} url
 * @returns {URL} the same URL
 * @throws {ProxyError} if the scheme or the address is refused
 */
function validateTarget(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError('Seules les URL http et https sont acceptées', 400);
  }

  const literal = parseLiteralAddress(url.hostname);
  if (literal && isBlockedAddress(literal.address, literal.family)) {
    throw new ProxyError('Adresse de destination interdite', 403);
  }

  return url;
}

/**
 * Opens the request to the target and validates its response.
 *
 * - No header of the client is forwarded: no cookie, Referer or User-Agent.
 *   "identity" avoids a compression that would make Content-Length inconsistent.
 * - Each redirect step is validated again: a redirect to 127.0.0.1 is refused.
 * - The tracker follows the current request, redirects included, for the deadline.
 * @param {URL} url - target already validated
 * @param {object} options - see openRemote
 * @param {number} redirectsLeft - redirects still allowed
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 */
function request(url, options, redirectsLeft) {
  const { accept, userAgent, allowedTypes, maxBytes, timeoutMs, label, lookup, tracker } = options;

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      lookup,
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

      if (tracker) tracker.response = response;
      resolve({
        contentType,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        stream: response
      });
    });

    if (tracker) tracker.req = req;

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
 * Prepares a URL given by a user: parsing, cleaning, validation. Credentials in
 * a URL would only serve to make the server test accesses, so they are removed.
 * @param {string} rawUrl - absolute http(s) URL
 * @returns {URL}
 * @throws {ProxyError} invalid or refused URL
 */
function prepareUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProxyError('URL invalide', 400);
  }

  url.username = '';
  url.password = '';
  url.hash = '';

  return validateTarget(url);
}

/**
 * Opens a remote resource with the SSRF protections.
 * The socket idle timeout does not stop a source that sends a byte now and then:
 * without a deadline, it would keep the connection forever.
 * @param {string} rawUrl - absolute http(s) URL
 * @param {object} options
 * @param {string} options.accept - Accept header sent
 * @param {string} options.userAgent - User-Agent header sent
 * @param {Set<string>} options.allowedTypes - accepted content types
 * @param {number} options.maxBytes - maximum size announced by Content-Length
 * @param {number} [options.timeoutMs] - socket idle timeout
 * @param {number} [options.deadlineMs] - maximum duration of the whole request
 *   (redirects and stream reading included), after which it is aborted
 * @param {string} options.label - name of the target in the (French) error messages
 * @param {Function} [options.lookup] - DNS resolution: only replace it in tests
 * @returns {Promise<{contentType: string, contentLength: number|null, stream: import('stream').Readable}>}
 * @throws {ProxyError} URL refused, host unreachable or unusable response
 */
async function openRemote(rawUrl, options) {
  const url = prepareUrl(rawUrl);
  const settings = { timeoutMs: DEFAULT_TIMEOUT_MS, lookup: safeLookup, ...options };
  if (!settings.deadlineMs) return request(url, settings, MAX_REDIRECTS);

  const tracker = { req: null, response: null };
  const deadline = new ProxyError(`${capitalize(settings.label)} met trop de temps à répondre`, 504);
  const timer = setTimeout(() => {
    if (tracker.response) tracker.response.destroy(deadline);
    else if (tracker.req) tracker.req.destroy(deadline);
  }, settings.deadlineMs);

  try {
    const remote = await request(url, { ...settings, tracker }, MAX_REDIRECTS);
    remote.stream.once('close', () => clearTimeout(timer));
    return remote;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/**
 * Reads a whole stream, refusing to go past a given size.
 * Content-Length is only declarative: the received bytes are counted again.
 * A ProxyError comes from openRemote (deadline exceeded) and is kept as is.
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
    stream.on('error', error => reject(error instanceof ProxyError
      ? error
      : new ProxyError('Réception interrompue', 502)));
  });
}

module.exports = { openRemote, readLimited, prepareUrl, validateTarget, ProxyError };
