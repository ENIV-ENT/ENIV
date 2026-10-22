import { apiCall } from './http.js';
import { showConfirm } from './dom.js';

/**
 * Browser side of push notifications: permission, subscription with the
 * browser's push service, then registration of that subscription on the server
 * (see backend/routes/push.js).
 * @module push
 */

const SUBSCRIBE_TIMEOUT_MS = 15000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * On iPhone and iPad, push only exists for an app added to the home screen.
 * @returns {boolean}
 */
export function needsHomeScreenInstall() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return isIos && !standalone;
}

/**
 * Returns the current push subscription. Uses getRegistration rather than
 * serviceWorker.ready, which never settles when the registration failed.
 * @returns {Promise<PushSubscription|null>}
 */
export async function getPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/**
 * The VAPID key comes as base64url; pushManager.subscribe expects bytes.
 * @param {string} base64Url
 * @returns {Uint8Array}
 */
function base64UrlToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function arrayBufferToBase64Url(buffer) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendSubscription(subscription) {
  return apiCall('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
}

/**
 * Asks for the permission, then subscribes this browser.
 *
 * serviceWorker.ready is wrapped in a timeout because it never settles when the
 * service worker does not register. A subscription created with another server
 * key would receive nothing, so it is recreated. Some browsers have no push
 * service at all (some Chromium builds, Brave with the option disabled), in
 * which case subscribe times out.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function enablePush() {
  if (!isPushSupported()) {
    return { ok: false, error: 'Ce navigateur ne prend pas en charge les notifications.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      error: permission === 'denied'
        ? 'Les notifications sont bloquées pour Eniv. Autorisez-les dans les réglages du navigateur (icône à gauche de l\'adresse).'
        : 'Autorisation non accordée.',
    };
  }

  const { publicKey, error } = await apiCall('/api/push/public-key');
  if (error || !publicKey) return { ok: false, error: error || 'Notifications indisponibles.' };

  let registration;
  try {
    registration = await withTimeout(navigator.serviceWorker.ready, SUBSCRIBE_TIMEOUT_MS);
  } catch {
    return { ok: false, error: 'Eniv n\'a pas pu préparer les notifications dans ce navigateur. Rechargez la page puis réessayez.' };
  }
  let subscription = await registration.pushManager.getSubscription();
  const key = subscription?.options?.applicationServerKey;
  if (subscription && key && arrayBufferToBase64Url(key) !== publicKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    try {
      subscription = await withTimeout(registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      }), SUBSCRIBE_TIMEOUT_MS);
    } catch {
      return { ok: false, error: 'Le service de notifications de ce navigateur ne répond pas. Essayez avec Chrome, Edge, Firefox ou Safari.' };
    }
  }

  const result = await sendSubscription(subscription);
  if (result.error) return { ok: false, error: result.error };
  return { ok: true };
}

export async function disablePush() {
  const subscription = await getPushSubscription();
  if (!subscription) return { ok: true };
  await apiCall('/api/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
  return { ok: true };
}

/** localStorage key holding `'keep'` or `'disable'`. */
const LOGOUT_CHOICE_KEY = 'push-logout-choice';

/**
 * Runs before logging out: the subscription of this device stays linked to the
 * account, so the user is asked whether to keep it. The choice can be
 * remembered on the device.
 * @returns {Promise<boolean>} false when the question is closed without an
 *   answer (the logout is then cancelled)
 */
export async function handlePushBeforeLogout() {
  const subscription = await getPushSubscription().catch(() => null);
  if (!subscription) return true;

  let choice = localStorage.getItem(LOGOUT_CHOICE_KEY);
  if (!choice) {
    const answer = await showConfirm(
      'Désactiver les notifications sur cet appareil ? Sinon, il continuera de recevoir celles de votre compte après la déconnexion.',
      'Notifications',
      { confirmLabel: 'Désactiver', cancelLabel: 'Les garder', checkboxLabel: 'Ne plus me demander' }
    );
    if (!answer) return false;
    choice = answer.confirmed ? 'disable' : 'keep';
    if (answer.checked) localStorage.setItem(LOGOUT_CHOICE_KEY, choice);
  }

  if (choice === 'disable') await disablePush().catch(() => {});
  return true;
}

/**
 * To call when a logged-in page opens: sends this browser's subscription, if
 * any, back to the server (renewed by the browser, account change...). Silent
 * on failure: it will be retried on the next page load.
 */
export async function syncPushSubscription() {
  try {
    if (!isPushSupported() || Notification.permission !== 'granted') return;
    const subscription = await getPushSubscription();
    if (subscription) await sendSubscription(subscription);
  } catch {
    return;
  }
}
