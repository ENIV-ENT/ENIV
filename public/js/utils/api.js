import { apiCall } from './http.js';
import { handlePushBeforeLogout } from './push.js';

export { apiCall };

/**
 * Empties the offline cache of API responses (see /sw.js). That cache does not
 * tell users apart, so it must be cleared whenever the logged-in account changes.
 */
export async function clearApiCache() {
  try {
    if ('caches' in window) await caches.delete('eniv-api');
  } catch {
    return;
  }
}

/**
 * Hint cookie shared with eniv.fr. It holds no secret (the token stays in
 * localStorage): it only says "logged in on this browser", so that the showcase
 * site sends the visitor straight to the app (see public-site/.htaccess).
 */
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
  const commonPaths = ["/settings/", "/quiz/", "/devoir-pdf/", "/emploi-du-temps/"];

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

/**
 * Checks the session and redirects to the page allowed for the user's role.
 * @returns {Promise<object>} The `/api/auth/me` payload, or `{ authenticated: false, error? }`.
 */
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

/**
 * Logs out. The push unsubscription runs before the logout call, because it
 * needs to be authenticated.
 */
export async function logout() {
  if (!await handlePushBeforeLogout()) return;
  await apiCall('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('token');
  setSessionHint(false);
  await clearApiCache();
  window.location.href = '/';
}
