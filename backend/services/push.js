const crypto = require('crypto');
const webpush = require('web-push');
const db = require('../models/dbHelper');
const { assignmentUpdated } = require('./pushMessages');

/**
 * Push notifications (Web Push, VAPID protocol).
 *
 * Works on Chrome, Edge and Firefox (desktop and Android), and on iPhone/iPad
 * (iOS 16.4+) when Eniv is added to the home screen.
 *
 * The VAPID keys identify the server to the browsers' push services. They come
 * from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; otherwise they are generated when
 * first needed and kept in the settings table, so no setup is needed. Changing
 * them invalidates every existing subscription.
 * @module
 */

const VAPID_SETTING_KEY = 'push_vapid_keys';
const DEFAULT_SUBJECT = 'mailto:contact@eniv.fr';

/** Preferences of a user who never changed anything. */
const DEFAULT_PREFERENCES = { nouveau_devoir: true, devoir_modifie: true, rappel_veille: true, nouveau_commentaire: 'participe' };
const BOOLEAN_PREFERENCES = ['nouveau_devoir', 'devoir_modifie', 'rappel_veille'];

/**
 * Comments: all those of the class, only the threads the student already wrote
 * in, or none.
 */
const COMMENT_MODES = ['tous', 'participe', 'aucun'];

/**
 * The server sends a POST to the endpoint: only the browsers' push services are
 * accepted, otherwise a student could make the server call an address internal to
 * the VPS or a third-party site.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.notify.windows.com'];
const MAX_SUBSCRIPTIONS_PER_USER = 10;

/** A push service that does not answer must not delay the other sends. */
const SEND_TIMEOUT_MS = 10000;

/**
 * A change right after the creation (often a fix by the author) is not worth a
 * second notification.
 */
const MODIFICATION_GRACE_MINUTES = 5;

let vapidPromise = null;

/** INSERT IGNORE: if two requests generate keys at the same time, the first one wins. */
async function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }

  const stored = await db.get('SELECT value FROM settings WHERE `key` = ?', [VAPID_SETTING_KEY]);
  if (stored && stored.value) return JSON.parse(stored.value);

  const keys = webpush.generateVAPIDKeys();
  await db.run('INSERT IGNORE INTO settings (`key`, value) VALUES (?, ?)', [VAPID_SETTING_KEY, JSON.stringify(keys)]);
  const saved = await db.get('SELECT value FROM settings WHERE `key` = ?', [VAPID_SETTING_KEY]);
  console.log('VAPID keys generated for push notifications');
  return JSON.parse(saved.value);
}

/** Loads the keys once; a failure is retried on the next call. */
async function getVapidKeys() {
  if (!vapidPromise) {
    vapidPromise = loadVapidKeys().then((keys) => {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || DEFAULT_SUBJECT, keys.publicKey, keys.privateKey);
      return keys;
    }).catch((error) => {
      vapidPromise = null;
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

/**
 * Validates the PushSubscription object sent by the browser.
 * @returns {{endpoint: string, p256dh: string, auth: string}|null}
 */
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
 * Saves a subscription. Sending again a subscription already saved for this
 * account is always allowed. The same browser can switch accounts: the
 * subscription follows the last logged-in one.
 * @returns {Promise<boolean>} false if the account already has too many subscribed devices
 */
async function saveSubscription(userId, subscription, userAgent) {
  const endpointHash = hashEndpoint(subscription.endpoint);
  const others = await db.get(
    'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND endpoint_hash <> ?',
    [userId, endpointHash]
  );
  if (Number(others.n) >= MAX_SUBSCRIPTIONS_PER_USER) return false;

  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh),
       auth = VALUES(auth), user_agent = VALUES(user_agent)`,
    [userId, subscription.endpoint, endpointHash, subscription.p256dh, subscription.auth,
      userAgent ? String(userAgent).slice(0, 255) : null]
  );
  return true;
}

/**
 * The order matters: Edge, Opera and Samsung Internet also claim to be Chrome,
 * Chrome claims to be Safari, and an iPhone claims to be "Mac OS X".
 */
const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/Firefox\/|FxiOS/, 'Firefox'],
  [/Chrome\/|CriOS/, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
];

/**
 * Readable name of a device from its user agent, in French: "Chrome sur Android".
 */
function describeUserAgent(userAgent) {
  const find = (list) => (list.find(([pattern]) => pattern.test(userAgent || '')) || [])[1];
  const browser = find(BROWSERS);
  const system = find(SYSTEMS);
  if (browser && system) return `${browser} sur ${system}`;
  return browser || system || 'Appareil inconnu';
}

async function listSubscriptions(userId) {
  const rows = await db.all(
    `SELECT id, endpoint_hash, user_agent, created_at, last_success_at
     FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return rows.map(({ user_agent: userAgent, ...row }) => ({ ...row, appareil: describeUserAgent(userAgent) }));
}

async function deleteSubscriptionById(userId, id) {
  const result = await db.run('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

async function deleteSubscription(userId, endpoint) {
  const result = await db.run(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?',
    [userId, hashEndpoint(endpoint)]
  );
  return result.changes > 0;
}

async function getPreferences(userId) {
  const row = await db.get('SELECT * FROM push_preferences WHERE user_id = ?', [userId]);
  if (!row) return { ...DEFAULT_PREFERENCES };
  const prefs = Object.fromEntries(BOOLEAN_PREFERENCES.map((key) => [key, Boolean(row[key])]));
  prefs.nouveau_commentaire = COMMENT_MODES.includes(row.nouveau_commentaire)
    ? row.nouveau_commentaire
    : DEFAULT_PREFERENCES.nouveau_commentaire;
  return prefs;
}

async function setPreferences(userId, input) {
  const prefs = { ...(await getPreferences(userId)) };
  for (const key of BOOLEAN_PREFERENCES) {
    if (typeof input[key] === 'boolean') prefs[key] = input[key];
  }
  if (COMMENT_MODES.includes(input.nouveau_commentaire)) prefs.nouveau_commentaire = input.nouveau_commentaire;
  await db.run(
    `INSERT INTO push_preferences (user_id, nouveau_devoir, devoir_modifie, rappel_veille, nouveau_commentaire)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nouveau_devoir = VALUES(nouveau_devoir),
       devoir_modifie = VALUES(devoir_modifie), rappel_veille = VALUES(rappel_veille),
       nouveau_commentaire = VALUES(nouveau_commentaire)`,
    [userId, prefs.nouveau_devoir, prefs.devoir_modifie, prefs.rappel_veille, prefs.nouveau_commentaire]
  );
  return prefs;
}

/**
 * Sends a notification to a list of subscriptions. Expired subscriptions (the
 * browser revoked the permission: 404/410) are deleted.
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
        console.error('Push notification failed:', error.statusCode || '', error.body || error.message);
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
 * Notifies every member of a class who enabled the given preference.
 * @param {number} classId
 * @param {'nouveau_devoir'|'devoir_modifie'} preference
 * @param {Object} payload - { title, body, url, tag }
 * @param {number|null} excludeUserId - author of the action, who does not need to be told
 */
async function notifyClass(classId, preference, payload, excludeUserId = null) {
  if (!BOOLEAN_PREFERENCES.includes(preference)) throw new Error(`Unknown preference: ${preference}`);

  const subs = await db.all(
    `SELECT ps.*
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN push_preferences pp ON pp.user_id = u.id
     WHERE u.classe_id = ? AND u.id <> ? AND COALESCE(pp.${preference}, TRUE)`,
    [classId, excludeUserId || 0]
  );
  return sendToSubscriptions(subs, payload);
}

/**
 * Tells the class about a new comment on an assignment, according to everyone's
 * nouveau_commentaire preference. The comment is already saved: the author is
 * excluded, so their own message does not make them count as a participant.
 * @param {number} classId
 * @param {number} assignmentId
 * @param {Object} payload - { title, body, url, tag }
 * @param {number|null} excludeUserId - author of the comment
 */
async function notifyComment(classId, assignmentId, payload, excludeUserId = null) {
  const subs = await db.all(
    `SELECT ps.*
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN push_preferences pp ON pp.user_id = u.id
     WHERE u.classe_id = ? AND u.id <> ?
       AND CASE COALESCE(pp.nouveau_commentaire, ?)
         WHEN 'tous' THEN TRUE
         WHEN 'participe' THEN EXISTS (
           SELECT 1 FROM devoir_commentaires dc WHERE dc.devoir_id = ? AND dc.user_id = u.id
         )
         ELSE FALSE
       END`,
    [classId, excludeUserId || 0, DEFAULT_PREFERENCES.nouveau_commentaire, assignmentId]
  );
  return sendToSubscriptions(subs, payload);
}

/**
 * Tells the class that an assignment changed, unless it was just created: the
 * students already got "Nouveau devoir" a few moments before.
 * @param {Object} assignment - snapshot after the change, with its id
 * @param {Array} changes - result of diffSnapshots
 */
async function notifyAssignmentUpdated(classId, assignment, changes, excludeUserId = null) {
  const row = await db.get(
    'SELECT created_at > NOW() - INTERVAL ? MINUTE AS recent FROM devoirs WHERE id = ?',
    [MODIFICATION_GRACE_MINUTES, assignment.id]
  );
  if (!row || Number(row.recent)) return null;
  return notifyClass(classId, 'devoir_modifie', assignmentUpdated(assignment, changes), excludeUserId);
}

/**
 * Starts a send without waiting for it: a failed notification must never delay
 * or break the HTTP response.
 */
function inBackground(send) {
  return (...args) => {
    send(...args).catch((error) => console.error('Class push notification failed:', error));
  };
}

module.exports = {
  DEFAULT_PREFERENCES,
  getPublicKey,
  parseSubscription,
  saveSubscription,
  deleteSubscription,
  describeUserAgent,
  listSubscriptions,
  deleteSubscriptionById,
  getPreferences,
  setPreferences,
  sendToUser,
  notifyClass,
  notifyClassInBackground: inBackground(notifyClass),
  notifyComment,
  notifyCommentInBackground: inBackground(notifyComment),
  notifyAssignmentUpdated,
  notifyAssignmentUpdatedInBackground: inBackground(notifyAssignmentUpdated),
};
