const crypto = require('crypto');
const webpush = require('web-push');
const db = require('../models/dbHelper');
const { devoirModifie } = require('./pushMessages');

/**
 * Notifications push (Web Push, protocole VAPID).
 *
 * Fonctionne sur Chrome, Edge et Firefox (ordinateur et Android), et sur
 * iPhone/iPad (iOS 16.4+) quand Eniv est ajouté à l'écran d'accueil.
 *
 * Les clés VAPID identifient le serveur auprès des services push des
 * navigateurs. Elles viennent de VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, sinon
 * elles sont générées au premier besoin et conservées dans la table settings :
 * aucune configuration n'est nécessaire. Les changer invalide tous les
 * abonnements existants.
 */

const VAPID_SETTING_KEY = 'push_vapid_keys';
const DEFAULT_SUBJECT = 'mailto:contact@eniv.fr';

// Préférences par défaut d'un utilisateur qui n'a jamais rien réglé
const DEFAULT_PREFERENCES = { nouveau_devoir: true, devoir_modifie: true, rappel_veille: true };
const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES);

// Le serveur envoie un POST à l'endpoint : seuls les services push des
// navigateurs sont acceptés, sinon un élève pourrait faire appeler une adresse
// interne au VPS ou un site tiers.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.notify.windows.com'];
const MAX_SUBSCRIPTIONS_PER_USER = 10;

// Un service push qui ne répond pas ne doit pas retarder les autres envois
const SEND_TIMEOUT_MS = 10000;

// Une modification juste après la création (souvent une correction de
// l'auteur) ne vaut pas une seconde notification
const MODIFICATION_GRACE_MINUTES = 5;

let vapidPromise = null;

async function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }

  const stored = await db.get('SELECT value FROM settings WHERE `key` = ?', [VAPID_SETTING_KEY]);
  if (stored && stored.value) return JSON.parse(stored.value);

  const keys = webpush.generateVAPIDKeys();
  // INSERT IGNORE : si deux requêtes génèrent en même temps, la première gagne
  await db.run('INSERT IGNORE INTO settings (`key`, value) VALUES (?, ?)', [VAPID_SETTING_KEY, JSON.stringify(keys)]);
  const saved = await db.get('SELECT value FROM settings WHERE `key` = ?', [VAPID_SETTING_KEY]);
  console.log('Clés VAPID générées pour les notifications push');
  return JSON.parse(saved.value);
}

async function getVapidKeys() {
  if (!vapidPromise) {
    vapidPromise = loadVapidKeys().then((keys) => {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || DEFAULT_SUBJECT, keys.publicKey, keys.privateKey);
      return keys;
    }).catch((error) => {
      vapidPromise = null; // réessayer au prochain appel
      throw error;
    });
  }
  return vapidPromise;
}

async function getPublicKey() {
  return (await getVapidKeys()).publicKey;
}

function hashEndpoint(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

/**
 * Valide l'objet PushSubscription envoyé par le navigateur.
 * @returns {{endpoint: string, p256dh: string, auth: string}|null}
 */
function isPushServiceEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  return PUSH_HOSTS.includes(url.hostname)
    || PUSH_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
}

function parseSubscription(body) {
  const sub = body && body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return null;
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (sub.endpoint.length > 2000 || !isPushServiceEndpoint(sub.endpoint)) return null;
  if (p256dh.length > 255 || auth.length > 255) return null;
  return { endpoint: sub.endpoint, p256dh, auth };
}

/**
 * @returns {Promise<boolean>} false si le compte a déjà trop d'appareils abonnés
 */
async function saveSubscription(userId, subscription) {
  const endpointHash = hashEndpoint(subscription.endpoint);
  // Renvoyer un abonnement déjà enregistré pour ce compte reste toujours possible
  const others = await db.get(
    'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND endpoint_hash <> ?',
    [userId, endpointHash]
  );
  if (Number(others.n) >= MAX_SUBSCRIPTIONS_PER_USER) return false;

  // Un même navigateur peut changer de compte : l'abonnement suit le dernier connecté
  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [userId, subscription.endpoint, endpointHash, subscription.p256dh, subscription.auth]
  );
  return true;
}

async function deleteSubscription(userId, endpoint) {
  const result = await db.run(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?',
    [userId, hashEndpoint(endpoint)]
  );
  return result.changes > 0;
}

async function countSubscriptions(userId) {
  const row = await db.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [userId]);
  return Number(row.n);
}

async function getPreferences(userId) {
  const row = await db.get('SELECT * FROM push_preferences WHERE user_id = ?', [userId]);
  if (!row) return { ...DEFAULT_PREFERENCES };
  return Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, Boolean(row[key])]));
}

async function setPreferences(userId, input) {
  const prefs = { ...(await getPreferences(userId)) };
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] === 'boolean') prefs[key] = input[key];
  }
  await db.run(
    `INSERT INTO push_preferences (user_id, nouveau_devoir, devoir_modifie, rappel_veille)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nouveau_devoir = VALUES(nouveau_devoir),
       devoir_modifie = VALUES(devoir_modifie), rappel_veille = VALUES(rappel_veille)`,
    [userId, prefs.nouveau_devoir, prefs.devoir_modifie, prefs.rappel_veille]
  );
  return prefs;
}

/**
 * Envoie une notification à une liste d'abonnements. Les abonnements expirés
 * (le navigateur a révoqué l'autorisation : 404/410) sont supprimés.
 * @returns {Promise<{sent: number, removed: number, failed: number}>}
 */
async function sendToSubscriptions(subscriptions, payload) {
  const stats = { sent: 0, removed: 0, failed: 0 };
  if (subscriptions.length === 0) return stats;

  await getVapidKeys();
  const body = JSON.stringify(payload);

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 * 24, urgency: payload.urgency || 'normal', topic: payload.topic, timeout: SEND_TIMEOUT_MS }
      );
      stats.sent++;
      db.run('UPDATE push_subscriptions SET last_success_at = UTC_TIMESTAMP() WHERE id = ?', [sub.id]).catch(() => {});
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        stats.removed++;
        await db.run('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]).catch(() => {});
      } else {
        stats.failed++;
        console.error('Notification push échouée:', error.statusCode || '', error.body || error.message);
      }
    }
  }));

  return stats;
}

async function sendToUser(userId, payload) {
  const subs = await db.all('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
  return sendToSubscriptions(subs, payload);
}

/**
 * Notifie tous les membres d'une classe ayant activé la préférence donnée.
 * @param {number} classeId
 * @param {'nouveau_devoir'|'devoir_modifie'} preference
 * @param {Object} payload - { title, body, url, tag }
 * @param {number|null} excludeUserId - auteur de l'action, qui n'a pas besoin d'être prévenu
 */
async function notifyClasse(classeId, preference, payload, excludeUserId = null) {
  if (!PREFERENCE_KEYS.includes(preference)) throw new Error(`Préférence inconnue : ${preference}`);

  const subs = await db.all(
    `SELECT ps.*
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN push_preferences pp ON pp.user_id = u.id
     WHERE u.classe_id = ? AND u.id <> ? AND COALESCE(pp.${preference}, TRUE)`,
    [classeId, excludeUserId || 0]
  );
  return sendToSubscriptions(subs, payload);
}

/**
 * Prévient la classe qu'un devoir a changé, sauf s'il vient d'être créé : les
 * élèves ont déjà reçu « Nouveau devoir » quelques instants plus tôt.
 * @param {Object} devoir - instantané après modification, avec son id
 * @param {Array} changes - résultat de diffSnapshots
 */
async function notifyDevoirModifie(classeId, devoir, changes, excludeUserId = null) {
  const row = await db.get(
    'SELECT created_at > NOW() - INTERVAL ? MINUTE AS recent FROM devoirs WHERE id = ?',
    [MODIFICATION_GRACE_MINUTES, devoir.id]
  );
  if (!row || Number(row.recent)) return null;
  return notifyClasse(classeId, 'devoir_modifie', devoirModifie(devoir, changes), excludeUserId);
}

/**
 * Lance un envoi sans l'attendre : une notification ratée ne doit jamais
 * retarder ni casser la réponse HTTP.
 */
function inBackground(send) {
  return (...args) => {
    send(...args).catch((error) => console.error('Notification push de classe échouée:', error));
  };
}

module.exports = {
  DEFAULT_PREFERENCES,
  getPublicKey,
  parseSubscription,
  saveSubscription,
  deleteSubscription,
  countSubscriptions,
  getPreferences,
  setPreferences,
  sendToUser,
  notifyClasse,
  notifyClasseInBackground: inBackground(notifyClasse),
  notifyDevoirModifie,
  notifyDevoirModifieInBackground: inBackground(notifyDevoirModifie),
};
