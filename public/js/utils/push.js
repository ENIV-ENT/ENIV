import { apiCall } from './api.js';
import { showConfirm } from './dom.js';

// Notifications push côté navigateur : permission, abonnement auprès du service
// push du navigateur, puis enregistrement de cet abonnement sur le serveur
// (voir backend/routes/push.js).

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

// Sur iPhone/iPad, le push n'existe que pour une app ajoutée à l'écran d'accueil
export function needsHomeScreenInstall() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return isIOS && !standalone;
}

export async function getPushSubscription() {
  if (!isPushSupported()) return null;
  // Pas serviceWorker.ready : elle n'aboutit jamais si l'enregistrement échoue
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

// La clé VAPID arrive en base64url ; pushManager.subscribe attend des octets
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
 * Demande la permission puis abonne ce navigateur.
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
    // serviceWorker.ready n'aboutit jamais si le service worker ne s'enregistre pas
    registration = await withTimeout(navigator.serviceWorker.ready, SUBSCRIBE_TIMEOUT_MS);
  } catch {
    return { ok: false, error: 'Eniv n\'a pas pu préparer les notifications dans ce navigateur. Rechargez la page puis réessayez.' };
  }
  let subscription = await registration.pushManager.getSubscription();
  // Un abonnement créé avec une autre clé serveur ne recevrait rien : on le refait
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
      // Navigateur sans service push (certains Chromium, Brave avec l'option désactivée...)
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

const LOGOUT_CHOICE_KEY = 'push-logout-choice'; // 'keep' | 'disable'

/**
 * Avant la déconnexion : l'abonnement de cet appareil reste lié au compte, on
 * demande donc s'il faut le garder. Le choix peut être mémorisé sur l'appareil.
 * @returns {Promise<boolean>} false si la question est fermée sans réponse
 *   (la déconnexion est alors abandonnée)
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
 * À appeler à l'ouverture des pages connectées : renvoie au serveur
 * l'abonnement de ce navigateur s'il existe (renouvelé par le navigateur,
 * changement de compte...). Silencieux en cas d'échec.
 */
export async function syncPushSubscription() {
  try {
    if (!isPushSupported() || Notification.permission !== 'granted') return;
    const subscription = await getPushSubscription();
    if (subscription) await sendSubscription(subscription);
  } catch {
    // Pas bloquant : on réessaiera à la prochaine ouverture
  }
}
