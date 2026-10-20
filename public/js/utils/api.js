import { getRealtimeId } from './realtime.js';
import { handlePushBeforeLogout } from './push.js';

export async function apiCall(url, options = {}) {
  try {
    const token = localStorage.getItem('token');
    // Évite que l'onglet à l'origine d'une modification reçoive sa propre
    // notification temps réel, et donc qu'il recharge deux fois les mêmes données.
    const realtimeId = getRealtimeId();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(realtimeId ? { 'X-Realtime-Id': realtimeId } : {}),
        ...options.headers,
      },
    });

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

// Le cache hors ligne des réponses API (voir /sw.js) ne distingue pas les
// utilisateurs : il doit être vidé dès que le compte connecté change.
export async function clearApiCache() {
  try {
    if ('caches' in window) await caches.delete('eniv-api');
  } catch {
    // Cache indisponible (navigation privée...) : rien à vider.
  }
}

// Cookie indicateur partagé avec eniv.fr : il ne contient aucun secret (le
// jeton reste dans localStorage), il dit seulement « connecté sur ce navigateur »
// pour que la vitrine renvoie directement vers l'app (voir public-site/.htaccess).
const SESSION_HINT_COOKIE = 'eniv_session';

function setSessionHint(loggedIn) {
  if (location.hostname !== 'eniv.fr' && !location.hostname.endsWith('.eniv.fr')) return;
  const maxAge = loggedIn ? 60 * 60 * 24 * 365 : 0;
  document.cookie = `${SESSION_HINT_COOKIE}=1; Domain=eniv.fr; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`;
}

function setLoadingScreenVisible(visible) {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.toggle('hidden', !visible);
  }
}

function getExpectedPaths(role) {
  const commonPaths = ["/settings/", "/quiz/", "/devoir-pdf/"];

  if (role === 'superadmin') {
    return ["/superadmin/dashboard/", ...commonPaths];
  }
  if (role === 'admin') {
    return ["/dashboard/", "/admin/", ...commonPaths];
  }
  return ["/dashboard/", ...commonPaths];
}

function normalizePath(path) {
  return path.endsWith('/') ? path : path + '/';
}

export async function checkAuth() {
  setLoadingScreenVisible(true);

  const AUTH_TIMEOUT_MS = 8000;

  let data;
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), AUTH_TIMEOUT_MS)
    );
    data = await Promise.race([apiCall('/api/auth/me'), timeout]);
  } catch {
    setLoadingScreenVisible(false);
    return { authenticated: false, error: true };
  }

  if (data && data.error) {
    setLoadingScreenVisible(false);
    return { authenticated: false, error: true };
  }

  if (!data || !data.authenticated) {
    const publicPaths = ["/", "/register/"];
    setSessionHint(false);
    if (!publicPaths.includes(normalizePath(window.location.pathname))) {
      localStorage.removeItem('token');
      await clearApiCache();
      window.location.href = "/";
      return { authenticated: false };
    }

    setLoadingScreenVisible(false);
    return { authenticated: false };
  }

  setSessionHint(true);
  const expectedPaths = getExpectedPaths(data.role);
  const currentPath = normalizePath(window.location.pathname);

  if (!expectedPaths.includes(currentPath)) {
    window.location.href = expectedPaths[0];
    return data;
  }

  setLoadingScreenVisible(false);
  return data;
}

export async function logout() {
  // Avant l'appel de déconnexion : désabonner l'appareil demande d'être authentifié
  if (!await handlePushBeforeLogout()) return;
  await apiCall('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('token');
  setSessionHint(false);
  await clearApiCache();
  window.location.href = '/';
}
