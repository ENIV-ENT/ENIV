/**
 * WebSocket client for realtime updates.
 *
 * The server only sends notifications about the user's class, and only after
 * authentication with the JWT already used by the REST API.
 * @module realtime
 */

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const BACKOFF_FACTOR = 1.7;
/** Longer than two server heartbeats (30 s each). */
const WATCHDOG_MS = 75000;
/** Past one missed heartbeat, continuity is no longer guaranteed. */
const CONTINUITY_LIMIT_MS = 45000;
const MAX_AUTH_FAILURES = 3;

/**
 * Close codes sent by the server. 4004 (silent client, typically a frozen tab)
 * is not handled separately: it follows the normal reconnection path, started
 * when the tab wakes up.
 */
const CLOSE_NORMAL = 1000;
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_TOKEN_EXPIRED = 4003;

/**
 * Stores the id of the current connection, given by the server on
 * authentication.
 *
 * It lives on window rather than in a module variable because imports are
 * versioned at deployment with a query string (`realtime.js?v=<hash>`) written
 * in each importing file. Two importers with diverging versions (one served by
 * the network, the other by the service worker cache) would load two separate
 * instances of this module, and the id written by one would be invisible to the
 * other: echo suppression would silently break.
 */
function setClientId(id) {
  window.__enivRealtimeId = id || null;
}

/**
 * Id to attach to mutating requests (X-Realtime-Id header) so that the server
 * does not send back to this tab a change it just made.
 * @returns {string|null}
 */
export function getRealtimeId() {
  return window.__enivRealtimeId || null;
}

/**
 * Opens a realtime connection and keeps it alive (reconnection, watchdog).
 *
 * - The watchdog closes half-open connections (sleep, NAT, silent proxy), whose
 *   close event would never fire on its own.
 * - Reconnection uses exponential backoff with jitter: when the server
 *   restarts, a whole class reconnects at the same time. The attempt counter is
 *   only reset on the `ready` frame, otherwise a server that accepts the
 *   connection but refuses the authentication would cause a 1 s loop.
 * - Heartbeats are answered from the `message` event rather than from an
 *   independent timer: the browser heavily throttles background tab timers (up
 *   to once a minute, or in five-minute slices), which would close healthy
 *   connections, while `message` events are not throttled.
 * - Handlers target their own `ws`, not `socket`: an old socket closing late
 *   must not interfere with the current connection.
 * - After repeated authentication failures, only realtime updates stop: session
 *   handling belongs to checkAuth/apiCall, not to this layer.
 * - When the tab becomes visible again, an open connection that received a
 *   frame recently proves that no notification was missed, so a resync only
 *   happens when continuity cannot be shown.
 * - pagehide is used rather than beforeunload: it works with the bfcache, and
 *   beforeunload does not fire reliably on iOS Safari. A page restored from the
 *   bfcache reconnects on pageshow, without relying on visibilitychange, whose
 *   timing around the bfcache varies between browsers.
 *
 * @param {Object} handlers
 * @param {Function} handlers.onUpdate - receives each notification {type:'update', resource, devoirId}
 * @param {Function} [handlers.onResync] - called after a RE-connection: reload everything
 * @returns {{close: Function, isConnected: Function}}
 */
export function connectRealtime({ onUpdate, onResync }) {
  let socket = null;
  let attempts = 0;
  let authFailures = 0;
  let hasConnectedOnce = false;
  let stopped = false;
  let reconnectTimer = null;
  let watchdogTimer = null;
  let lastFrameAt = 0;

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      return;
    }
  }

  function resetWatchdog(ws) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      ws.close();
    }, WATCHDOG_MS);
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;

    const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempts));
    const delay = base * (0.5 + Math.random() * 0.5);
    attempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function open() {
    if (stopped) return;
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket = ws;

    ws.addEventListener('open', () => {
      send(ws, { type: 'auth', token: localStorage.getItem('token') });
      resetWatchdog(ws);
    });

    ws.addEventListener('message', (event) => {
      resetWatchdog(ws);
      lastFrameAt = Date.now();

      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message) return;

      if (message.type === 'ready') {
        attempts = 0;
        authFailures = 0;
        setClientId(message.clientId);
        if (hasConnectedOnce) {
          if (onResync) onResync();
        } else {
          hasConnectedOnce = true;
        }
        return;
      }

      if (message.type === 'heartbeat') {
        send(ws, { type: 'heartbeat' });
        return;
      }

      if (message.type === 'update' && onUpdate) onUpdate(message);
    });

    ws.addEventListener('close', (event) => {
      if (socket !== ws) return;

      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      socket = null;
      setClientId(null);

      if (stopped || event.code === CLOSE_NORMAL) return;

      if (event.code === CLOSE_TOKEN_EXPIRED) {
        attempts = 0;
        scheduleReconnect();
        return;
      }

      if (event.code === CLOSE_AUTH_FAILED) {
        authFailures++;
        if (authFailures >= MAX_AUTH_FAILURES) {
          stopped = true;
          console.warn('Realtime updates disabled (authentication refused).');
          return;
        }
      }

      scheduleReconnect();
    });
  }

  function reconnectNow() {
    if (stopped) return;
    clearReconnectTimer();
    attempts = 0;
    open();
  }

  window.addEventListener('online', reconnectNow);
  window.addEventListener('offline', clearReconnectTimer);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reconnectNow();
      return;
    }

    if (Date.now() - lastFrameAt > CONTINUITY_LIMIT_MS && onResync) onResync();
  });

  window.addEventListener('pagehide', () => {
    if (socket) socket.close(CLOSE_NORMAL);
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) reconnectNow();
  });

  open();

  return {
    close() {
      stopped = true;
      clearReconnectTimer();
      if (socket) socket.close(CLOSE_NORMAL);
    },
    isConnected() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    }
  };
}
