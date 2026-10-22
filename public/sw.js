/**
 * Eniv service worker: makes the app installable and readable offline.
 *
 * - Pages, CSS/JS and API: network first. When the network takes longer than
 *   NETWORK_TIMEOUT_MS and a copy exists, the copy is served and the cache is
 *   updated in the background; without a copy, the network is awaited. The
 *   cache alone is only served when the request fails (offline). There is no
 *   "cache first" for JS: the ?v=<hash> are only added at deployment, so a
 *   stale module would break the page in development.
 * - Images: cache first, updated in the background.
 * - API: only the reads listed in API_ALLOWLIST. The API cache ignores the
 *   Authorization header, so it is emptied on every login and logout (see
 *   clearApiCache in js/utils/api.js). The server already keeps the last
 *   timetable when the ICS source is down; this cache also covers a device
 *   without network.
 *
 * Everything else (POST/PUT/DELETE, /api/fichiers, /api/proxy, WebSocket...) is
 * not intercepted, even when opened in a tab.
 *
 * API_CACHE has a fixed name: it is shared with the page that empties it.
 */
const VERSION = 'v5';
const PAGES_CACHE = `eniv-pages-${VERSION}`;
const STATIC_CACHE = `eniv-static-${VERSION}`;
const API_CACHE = 'eniv-api';
const KNOWN_CACHES = [PAGES_CACHE, STATIC_CACHE, API_CACHE];

const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE_PAGES = ['/', '/dashboard/', '/emploi-du-temps/'];
const PRECACHE_STATIC = [
  '/manifest.webmanifest',
  '/images/logo.png',
  '/images/logo.ico',
  '/images/icon-192.png',
];

const CODE_PREFIXES = ['/css/', '/js/', '/quiz/'];
const IMAGE_PREFIXES = ['/images/', '/vendor/'];
const BYPASS_PREFIXES = ['/api/'];
const API_ALLOWLIST = [
  '/api/auth/me',
  '/api/devoirs',
  '/api/devoirs/settings/emploi-temps',
  '/api/admin/matieres',
  '/api/emploi-temps',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const pages = await caches.open(PAGES_CACHE);
    await Promise.allSettled(PRECACHE_PAGES.map((url) => cachePage(pages, url)));
    const statics = await caches.open(STATIC_CACHE);
    await Promise.allSettled(PRECACHE_STATIC.map((url) => statics.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('eniv-') && !KNOWN_CACHES.includes(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const startsWith = (prefixes) => prefixes.some((prefix) => url.pathname.startsWith(prefix));

  if (API_ALLOWLIST.includes(url.pathname) && !url.search) {
    event.respondWith(handleApi(event, request));
  } else if (startsWith(BYPASS_PREFIXES)) {
    return;
  } else if (request.mode === 'navigate') {
    event.respondWith(handlePage(event, request));
  } else if (startsWith(CODE_PREFIXES)) {
    event.respondWith(handleCode(event, request));
  } else if (startsWith(IMAGE_PREFIXES)) {
    event.respondWith(handleImage(event, request));
  }
});

/**
 * Network first, without ever cancelling the request: past the delay, a cached
 * copy is served when it exists, and the network response updates the cache.
 * @param {FetchEvent} event
 * @param {Request} request
 * @param {(response: Response) => Promise<Response>} store saves the response and returns the one to serve
 * @param {() => Promise<Response|undefined>} lookup finds the cached copy
 * @returns {Promise<Response>} Rejects only when the network fails and there is no copy.
 */
async function networkFirst(event, request, store, lookup) {
  const network = fetch(request).then(store);
  event.waitUntil(network.catch(() => {}));

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, NETWORK_TIMEOUT_MS);
  });

  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const cached = await lookup();
    return cached || await network;
  } catch (error) {
    const cached = await lookup();
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Precaches a page. The browser refuses a redirected response (/dashboard ->
 * /dashboard/) for a navigation: a "clean" copy is stored under the final URL
 * and a real redirect is returned, so that the page opens at the right address
 * (quiz/index.html loads "quiz.js" with a relative path).
 */
async function cachePage(cache, url) {
  const response = await fetch(url);
  if (response.ok) await cache.put(response.url, await cleanResponse(response));
}

async function cleanResponse(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function withTrailingSlash(url) {
  const u = new URL(url);
  u.search = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

async function handlePage(event, request) {
  const cache = await caches.open(PAGES_CACHE);
  const store = async (response) => {
    if (!response.ok) return response;
    const clean = await cleanResponse(response);
    await cache.put(response.url, clean.clone());
    return response.redirected ? Response.redirect(response.url, 302) : clean;
  };
  const lookup = async () => {
    const exact = await cache.match(request, { ignoreSearch: true });
    if (exact) return exact;
    const slashed = withTrailingSlash(request.url);
    if (slashed === request.url) return undefined;
    return (await cache.match(slashed)) ? Response.redirect(slashed, 302) : undefined;
  };
  try {
    return await networkFirst(event, request, store, lookup);
  } catch {
    return new Response(
      '<!DOCTYPE html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
      + '<title>Hors ligne - Eniv</title><body style="font-family:sans-serif;text-align:center;padding:3rem 1rem">'
      + '<h1>Hors ligne</h1><p>Cette page n\'a pas encore été enregistrée sur cet appareil.</p>'
      + '<p><a href="/dashboard/">Retour à mes devoirs</a></p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleApi(event, request) {
  const cache = await caches.open(API_CACHE);
  const store = async (response) => {
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  };
  try {
    return await networkFirst(event, request, store, () => cache.match(request.url));
  } catch {
    return new Response(JSON.stringify({ error: 'Hors ligne' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Every deployment changes the ?v=<hash> of modified files: only the last
 * version received of each file is kept, otherwise the cache grows with every
 * release.
 */
async function handleCode(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const store = async (response) => {
    if (!response.ok) return response;
    await cache.put(request, response.clone());
    const versions = await cache.keys(request, { ignoreSearch: true });
    await Promise.all(versions
      .filter((cached) => cached.url !== request.url)
      .map((cached) => cache.delete(cached)));
    return response;
  };
  return networkFirst(event, request, store, () => cache.match(request));
}

async function handleImage(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

/**
 * Push notifications. The server (backend/services/push.js) sends
 * `{ title, body, url, tag }`; a notification with the same tag replaces the
 * previous one instead of piling up.
 */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Eniv', {
    body: data.body || '',
    icon: '/images/icon-192.png',
    badge: '/images/icon-192.png',
    lang: 'fr',
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/dashboard/' },
  }));
});

/** On click, reuse an Eniv tab already open rather than opening a new one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/dashboard/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if ('navigate' in client) return client.navigate(target);
      return undefined;
    }
    return self.clients.openWindow(target);
  })());
});

/**
 * The browser renewed the subscription (rare). The service worker does not have
 * the login token: the page sends the new subscription to the server the next
 * time it opens (syncPushSubscription in js/utils/push.js).
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription?.options;
    if (!options) return;
    const subscription = await self.registration.pushManager.subscribe(options);
    return subscription;
  })());
});
