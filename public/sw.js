// Service worker Eniv : rend l'app installable et consultable hors ligne.
//
// - Pages, CSS/JS et API : réseau d'abord. Si le réseau met plus de
//   NETWORK_TIMEOUT_MS à répondre et qu'une copie existe, la copie est servie
//   et le cache se met à jour en arrière-plan ; sans copie, on attend le
//   réseau. Le cache n'est servi seul que si la requête échoue (hors ligne).
//   (Pas de « cache d'abord » sur le JS : les ?v=<hash> ne sont ajoutés qu'au
//   déploiement, un module périmé casserait la page en développement.)
// - Images : cache d'abord, mise à jour en arrière-plan.
// - API : uniquement les lectures listées dans API_ALLOWLIST. Le cache API
//   ignore l'en-tête Authorization : il est vidé à chaque connexion/déconnexion
//   (voir clearApiCache dans js/utils/api.js).
//
// Tout le reste (POST/PUT/DELETE, /api/fichiers, /api/proxy, WebSocket...) n'est
// pas intercepté, y compris quand il est ouvert dans un onglet.

const VERSION = 'v3';
const PAGES_CACHE = `eniv-pages-${VERSION}`;
const STATIC_CACHE = `eniv-static-${VERSION}`;
const API_CACHE = 'eniv-api'; // nom fixe : partagé avec la page qui le vide
const KNOWN_CACHES = [PAGES_CACHE, STATIC_CACHE, API_CACHE];

const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE_PAGES = ['/', '/dashboard/'];
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
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Un échec isolé ne doit pas empêcher l'installation du service worker.
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

// Réseau d'abord, sans jamais annuler la requête : au-delà du délai, une copie
// en cache est servie si elle existe, et la réponse réseau met le cache à jour.
// `store(response)` enregistre la réponse et renvoie celle à servir ;
// `lookup()` cherche la copie en cache. Rejette seulement si le réseau échoue
// et qu'il n'y a aucune copie.
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

// Une réponse issue d'une redirection (/dashboard -> /dashboard/) est refusée
// par le navigateur pour une navigation : on en range une copie « propre » sous
// l'URL finale et on renvoie une vraie redirection, pour que la page s'ouvre à
// la bonne adresse (quiz/index.html charge « quiz.js » en relatif).
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

async function handleCode(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const store = async (response) => {
    if (response.ok) await cache.put(request, response.clone());
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

// ============= NOTIFICATIONS PUSH =============
// Le serveur (backend/services/push.js) envoie { title, body, url, tag }.

self.addEventListener('push', (event) => {
  let data = {};
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
    // Même tag = la nouvelle notification remplace l'ancienne au lieu de s'empiler
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/dashboard/' },
  }));
});

// Au clic : réutiliser un onglet Eniv déjà ouvert plutôt que d'en ouvrir un nouveau
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

// Le navigateur a renouvelé l'abonnement (rare) : prévenir le serveur
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription?.options;
    if (!options) return;
    const subscription = await self.registration.pushManager.subscribe(options);
    // Le service worker n'a pas le jeton de connexion : c'est la page qui
    // renverra ce nouvel abonnement au serveur à sa prochaine ouverture
    // (syncPushSubscription dans js/utils/push.js).
    return subscription;
  })());
});
