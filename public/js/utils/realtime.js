// Client WebSocket pour les mises à jour temps réel.
//
// Le serveur n'envoie que des notifications de la classe de l'utilisateur, et
// uniquement après authentification par le JWT déjà utilisé par l'API REST.

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const BACKOFF_FACTOR = 1.7;
const WATCHDOG_MS = 75000; // supérieur à deux battements de cœur serveur (30 s)
const CONTINUITY_LIMIT_MS = 45000; // au-delà d'un battement manqué, on ne garantit plus rien
const MAX_AUTH_FAILURES = 3;

const CLOSE_NORMAL = 1000;
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_TOKEN_EXPIRED = 4003;
// 4004 (client silencieux, typiquement un onglet gelé) n'est pas traité à part :
// il suit le chemin normal de reconnexion, déclenché au réveil de l'onglet.

// Identifiant de la connexion courante, fourni par le serveur à l'authentification.
//
// Il est stocké sur window et non dans une variable de module, car les imports de
// ce projet sont versionnés au déploiement par une chaîne de requête
// (`realtime.js?v=<hash>`) écrite dans chaque fichier importateur. Deux
// importateurs dont les versions divergeraient (l'un servi par le réseau, l'autre
// par le cache du service worker) chargeraient deux instances distinctes du
// module, et l'identifiant écrit par l'une serait invisible à l'autre — panne
// silencieuse de la suppression d'écho.
function setClientId(id) {
  window.__enivRealtimeId = id || null;
}

/**
 * Identifiant à joindre aux requêtes mutantes (en-tête X-Realtime-Id) pour que le
 * serveur ne rediffuse pas à cet onglet une modification qu'il vient de faire.
 * @returns {string|null}
 */
export function getRealtimeId() {
  return window.__enivRealtimeId || null;
}

/**
 * Ouvre une connexion temps réel et la maintient (reconnexion, chien de garde).
 *
 * @param {Object} handlers
 * @param {Function} handlers.onUpdate - reçoit chaque notification {type:'update', resource, devoirId}
 * @param {Function} [handlers.onResync] - appelé après une RE-connexion : tout recharger
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
  let lastFrameAt = 0; // date de la dernière trame reçue, pour juger de la continuité

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // Le socket peut s'être fermé entre la réception d'une trame et notre réponse.
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      // Rien à faire : la fermeture déclenchera la reconnexion.
    }
  }

  function resetWatchdog(ws) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      // Connexion à moitié ouverte (mise en veille, NAT, proxy silencieux) :
      // l'événement close ne se déclencherait jamais tout seul.
      ws.close();
    }, WATCHDOG_MS);
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;

    const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempts));
    // Pleine gigue : au redémarrage du serveur, toute une classe se reconnecte
    // en même temps.
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
    // Les gestionnaires ciblent `ws` et non `socket` : un ancien socket qui se
    // ferme tardivement ne doit pas interférer avec la connexion courante.
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket = ws;

    ws.addEventListener('open', () => {
      // Le compteur de tentatives n'est remis à zéro qu'à la trame 'ready' : un
      // serveur qui accepte la connexion puis refuse l'authentification
      // provoquerait sinon une boucle à 1 s.
      send(ws, { type: 'auth', token: localStorage.getItem('token') });
      resetWatchdog(ws);
    });

    ws.addEventListener('message', (event) => {
      resetWatchdog(ws);
      lastFrameAt = Date.now();

      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
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
        // Réponse applicative : elle prouve au serveur que ce JavaScript tourne
        // encore. Répondre à la trame reçue plutôt que battre sur une minuterie
        // indépendante est volontaire : les minuteries d'un onglet en arrière-plan
        // sont fortement ralenties par le navigateur (jusqu'à une fois par minute,
        // voire par tranches de cinq minutes), ce qui ferait fermer des connexions
        // parfaitement saines. Un événement 'message', lui, n'est pas ralenti.
        send(ws, { type: 'heartbeat' });
        return;
      }

      if (message.type === 'update' && onUpdate) onUpdate(message);
    });

    ws.addEventListener('close', (event) => {
      // Fermeture d'un socket déjà remplacé : rien à faire.
      if (socket !== ws) return;

      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      socket = null;
      setClientId(null); // l'identifiant est propre à la connexion fermée

      if (stopped || event.code === CLOSE_NORMAL) return;

      if (event.code === CLOSE_TOKEN_EXPIRED) {
        // Le token a peut-être été renouvelé entre-temps : une tentative immédiate.
        attempts = 0;
        scheduleReconnect();
        return;
      }

      if (event.code === CLOSE_AUTH_FAILED) {
        authFailures++;
        if (authFailures >= MAX_AUTH_FAILURES) {
          stopped = true;
          // On désactive uniquement les mises à jour temps réel : la gestion de
          // session appartient à checkAuth/apiCall, pas à cette couche.
          console.warn('Mises à jour temps réel désactivées (authentification refusée).');
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

  // Au retour sur l'onglet. Depuis la mise en place du battement de cœur
  // bidirectionnel, une connexion ouverte qui a reçu une trame récemment prouve
  // qu'aucune notification n'a pu être manquée : resynchroniser systématiquement
  // coûterait deux requêtes à chaque changement d'onglet pour rien. On ne
  // recharge donc que si la continuité n'est pas démontrable.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // La reconnexion déclenche elle-même onResync une fois authentifiée.
      reconnectNow();
      return;
    }

    if (Date.now() - lastFrameAt > CONTINUITY_LIMIT_MS && onResync) onResync();
  });

  // pagehide plutôt que beforeunload : compatible bfcache, et beforeunload n'est
  // pas déclenché de façon fiable sur iOS Safari.
  window.addEventListener('pagehide', () => {
    if (socket) socket.close(CLOSE_NORMAL);
  });

  // Retour depuis le cache de navigation arrière/avant : la page est restaurée
  // telle quelle, mais son socket a été fermé par pagehide ci-dessus. Ne pas
  // dépendre de visibilitychange, dont le déclenchement autour du bfcache varie
  // selon les navigateurs.
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
