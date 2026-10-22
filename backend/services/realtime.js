const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/dbHelper');
const { verifyToken } = require('../middleware/auth');

/**
 * Realtime broadcast service.
 *
 * Each socket is authenticated with the same JWT as the REST API, then attached
 * to the user's class. A notification for class X is only sent to the sockets of
 * class X.
 *
 * Warning: the registry is in memory, so this service assumes a single Node
 * process. A cluster deployment (PM2 cluster, several replicas) would break the
 * broadcast and need an external bus (Redis pub/sub).
 *
 * Application close codes (4000-4999 range):
 * - 4001 CLOSE_AUTH_FAILED: final refusal, the client must not loop;
 * - 4002 CLOSE_AUTH_TIMEOUT;
 * - 4003 CLOSE_TOKEN_EXPIRED: the client can retry with a fresh token;
 * - 4004 CLOSE_CLIENT_SILENT: no application frame anymore, the client can retry.
 * @module
 */

/** Below the usual idle timeout of proxies (60 s). */
const HEARTBEAT_INTERVAL_MS = 30000;
const AUTH_TIMEOUT_MS = 10000;
/** About 5 minutes. */
const REVALIDATE_EVERY_N_TICKS = 10;
/** Three missed heartbeats. */
const CLIENT_SILENCE_LIMIT_MS = 90000;

const CLOSE_AUTH_FAILED = 4001;
const CLOSE_AUTH_TIMEOUT = 4002;
const CLOSE_TOKEN_EXPIRED = 4003;
const CLOSE_CLIENT_SILENT = 4004;

let wss = null;
let heartbeatTimer = null;
let tickCount = 0;

/** classId (number) -> Set<WebSocket> */
const clientsByClass = new Map();

function addClient(ws, user) {
  ws.userId = user.id;
  ws.classId = user.classe_id;

  let sockets = clientsByClass.get(user.classe_id);
  if (!sockets) {
    sockets = new Set();
    clientsByClass.set(user.classe_id, sockets);
  }
  sockets.add(ws);
}

/**
 * Idempotent: every exit path (close, error, terminate, auth failure) goes through
 * here, so no entry leaks in the registry.
 */
function removeClient(ws) {
  if (ws.authTimer) {
    clearTimeout(ws.authTimer);
    ws.authTimer = null;
  }

  const sockets = clientsByClass.get(ws.classId);
  if (!sockets) return;

  sockets.delete(ws);
  if (sockets.size === 0) {
    clientsByClass.delete(ws.classId);
  }
}

/**
 * Authenticates a socket with the JWT sent by the client.
 *
 * - verifyToken only reads req.headers.authorization: it gets a compatible object
 *   instead of duplicating the JWT check.
 * - An unexpected error (database down for instance) closes with a "server error"
 *   code, so the client retries instead of giving up.
 * - A superadmin or a student without a class has nothing relevant to receive.
 * - The connection id sent back is joined by the client to its mutating requests,
 *   so the server does not broadcast back its own action, already applied locally.
 *   It is not an authentication secret: at worst, a leaked id deprives a
 *   connection of one notification.
 */
async function handleAuth(ws, token) {
  let user;
  try {
    user = await verifyToken({ headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    console.error('WebSocket authentication failed:', error);
    ws.close(1011, 'Server error');
    return;
  }

  if (!user) {
    ws.close(CLOSE_AUTH_FAILED, 'Authentication failed');
    return;
  }

  if (!user.classe_id) {
    ws.close(CLOSE_AUTH_FAILED, 'No class');
    return;
  }

  clearTimeout(ws.authTimer);
  ws.authTimer = null;

  const decoded = jwt.decode(token);
  ws.tokenExp = decoded && decoded.exp ? decoded.exp : null;

  ws.clientId = crypto.randomUUID();

  addClient(ws, user);
  ws.send(JSON.stringify({ type: 'ready', clientId: ws.clientId }));
}

/**
 * Sets up a new socket.
 *
 * ws.lastSeen is the last application frame received from the client. The
 * protocol pong is not enough: it is sent by the browser's network layer, even
 * when the tab's JavaScript is frozen. Only an application frame proves the client
 * actually handles what it receives. Once authenticated, the client only sends
 * heartbeats; an invalid frame is ignored and the auth timer ends up closing.
 * 'error' is always followed by 'close', but removeClient is idempotent.
 */
function handleConnection(ws) {
  ws.isAlive = true;
  ws.classId = null;
  ws.userId = null;
  ws.lastSeen = Date.now();
  ws.authTimer = setTimeout(() => {
    ws.close(CLOSE_AUTH_TIMEOUT, 'Authentication timeout');
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (raw) => {
    ws.lastSeen = Date.now();

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message) return;

    if (ws.classId) return;

    if (message.type !== 'auth' || typeof message.token !== 'string') return;

    handleAuth(ws, message.token);
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('error', () => removeClient(ws));
  ws.on('close', () => removeClient(ws));
}

/**
 * Checks that the class attached to the socket still matches the database: a
 * student moved or deleted must not keep receiving the notifications of their
 * former class until their token expires.
 */
async function revalidateClass(ws) {
  try {
    const user = await db.get('SELECT classe_id FROM users WHERE id = ?', [ws.userId]);
    if (!user || user.classe_id !== ws.classId) {
      ws.close(CLOSE_AUTH_FAILED, 'Class changed');
    }
  } catch (error) {
    console.error('Failed to revalidate a socket:', error);
  }
}

/**
 * Pings every socket and closes the dead, expired or silent ones.
 * The client answers every heartbeat: a long silence means its JavaScript no
 * longer runs (frozen tab), even if the TCP connection holds. Browsers do not
 * expose pong frames to JavaScript, hence the application heartbeat frame, which
 * the client-side watchdog observes.
 */
function heartbeat() {
  tickCount++;
  const shouldRevalidate = tickCount % REVALIDATE_EVERY_N_TICKS === 0;
  const nowInSeconds = Date.now() / 1000;

  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping();

    if (!ws.classId) return;

    if (ws.tokenExp && nowInSeconds > ws.tokenExp) {
      ws.close(CLOSE_TOKEN_EXPIRED, 'Token expired');
      return;
    }

    if (Date.now() - ws.lastSeen > CLIENT_SILENCE_LIMIT_MS) {
      ws.close(CLOSE_CLIENT_SILENT, 'Silent client');
      return;
    }

    ws.send(JSON.stringify({ type: 'heartbeat' }));

    if (shouldRevalidate) revalidateClass(ws);
  });
}

/**
 * Starts the WebSocket server on /ws. Calling it again (nodemon restart) returns
 * the running server. The payload limit is low: the client only sends a short
 * authentication frame.
 */
function init(server) {
  if (wss) return wss;

  wss = new WebSocket.Server({
    server,
    path: '/ws',
    maxPayload: 4096
  });

  wss.on('connection', handleConnection);

  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  return wss;
}

/**
 * Sends a message to every socket of a class.
 * @param {number} classId
 * @param {Object} message
 * @param {string|null} excludeClientId - connection that made the change, which
 *   already updated its own display and has nothing to reload
 */
function notifyClass(classId, message, excludeClientId = null) {
  if (classId == null) return;

  const sockets = clientsByClass.get(classId);
  if (!sockets || sockets.size === 0) return;

  const payload = JSON.stringify(message);
  sockets.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (excludeClientId && ws.clientId === excludeClientId) return;
    try {
      ws.send(payload);
    } catch {
      removeClient(ws);
    }
  });
}

function close() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
  clientsByClass.clear();
}

function getStats() {
  let sockets = 0;
  clientsByClass.forEach((set) => {
    sockets += set.size;
  });
  return { classes: clientsByClass.size, sockets };
}

module.exports = { init, notifyClass, close, getStats };
