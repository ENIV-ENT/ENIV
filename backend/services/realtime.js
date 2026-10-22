const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/dbHelper');
const { verifyToken } = require('../middleware/auth');

// Service de diffusion temps réel.
//
// Chaque socket est authentifié avec le même JWT que l'API REST, puis rattaché à
// la classe de l'utilisateur. Une notification destinée à la classe X n'est envoyée
// qu'aux sockets de la classe X.
//
// Attention : le registre est en mémoire, donc ce service suppose un unique
// processus Node. Un déploiement en cluster (PM2 cluster, plusieurs répliques)
// casserait la diffusion et nécessiterait un bus externe (Redis pub/sub).

const HEARTBEAT_INTERVAL_MS = 30000; // sous le timeout d'inactivité habituel des proxys (60 s)
const AUTH_TIMEOUT_MS = 10000;
const REVALIDATE_EVERY_N_TICKS = 10; // ~5 minutes
const CLIENT_SILENCE_LIMIT_MS = 90000; // trois battements manqués

// Codes de fermeture applicatifs (plage 4000-4999 réservée aux applications)
const CLOSE_AUTH_FAILED = 4001; // refus définitif : le client ne doit pas boucler
const CLOSE_AUTH_TIMEOUT = 4002;
const CLOSE_TOKEN_EXPIRED = 4003; // le client peut réessayer avec un token frais
const CLOSE_CLIENT_SILENT = 4004; // plus aucune trame applicative : le client peut réessayer

let wss = null;
let heartbeatTimer = null;
let tickCount = 0;

// classeId (number) -> Set<WebSocket>
const clientsByClasse = new Map();

function addClient(ws, user) {
  ws.userId = user.id;
  ws.classeId = user.classe_id;

  let sockets = clientsByClasse.get(user.classe_id);
  if (!sockets) {
    sockets = new Set();
    clientsByClasse.set(user.classe_id, sockets);
  }
  sockets.add(ws);
}

// Idempotent : tous les chemins de sortie (close, error, terminate, échec d'auth)
// passent par ici, ce qui garantit qu'aucune entrée ne fuit dans le registre.
function removeClient(ws) {
  if (ws.authTimer) {
    clearTimeout(ws.authTimer);
    ws.authTimer = null;
  }

  const sockets = clientsByClasse.get(ws.classeId);
  if (!sockets) return;

  sockets.delete(ws);
  if (sockets.size === 0) {
    clientsByClasse.delete(ws.classeId);
  }
}

async function handleAuth(ws, token) {
  let user;
  try {
    // verifyToken ne lit que req.headers.authorization : on lui passe un objet
    // compatible plutôt que de dupliquer la vérification du JWT.
    user = await verifyToken({ headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    // Erreur inattendue (base de données indisponible par exemple) : on ferme avec
    // un code "erreur serveur" pour que le client réessaie au lieu d'abandonner.
    console.error('Erreur lors de l\'authentification WebSocket:', error);
    ws.close(1011, 'Erreur serveur');
    return;
  }

  if (!user) {
    ws.close(CLOSE_AUTH_FAILED, 'Authentification échouée');
    return;
  }

  if (!user.classe_id) {
    // Superadmin ou élève sans classe : rien de pertinent à lui diffuser.
    ws.close(CLOSE_AUTH_FAILED, 'Aucune classe associée');
    return;
  }

  clearTimeout(ws.authTimer);
  ws.authTimer = null;

  const decoded = jwt.decode(token);
  ws.tokenExp = decoded && decoded.exp ? decoded.exp : null;

  // Identifiant de connexion renvoyé au client : il le joint à ses requêtes
  // mutantes pour que le serveur ne lui rediffuse pas sa propre action, qu'il a
  // déjà appliquée localement. Ce n'est pas un secret d'authentification : au pire,
  // un identifiant divulgué prive une connexion d'une notification.
  ws.clientId = crypto.randomUUID();

  addClient(ws, user);
  ws.send(JSON.stringify({ type: 'ready', clientId: ws.clientId }));
}

function handleConnection(ws) {
  ws.isAlive = true;
  ws.classeId = null;
  ws.userId = null;
  // Dernière trame applicative reçue du client. Le pong protocolaire ne suffit pas :
  // il est émis par la couche réseau du navigateur, y compris lorsque le JavaScript
  // de l'onglet est gelé. Seule une trame applicative prouve que le client traite
  // réellement ce qu'on lui envoie.
  ws.lastSeen = Date.now();
  ws.authTimer = setTimeout(() => {
    ws.close(CLOSE_AUTH_TIMEOUT, 'Authentification expirée');
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (raw) => {
    ws.lastSeen = Date.now();

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // trame invalide : ignorée, le timer d'auth finira par fermer
    }
    if (!message) return;

    // Une fois authentifié, le client n'envoie plus que des battements de cœur.
    if (ws.classeId) return;

    if (message.type !== 'auth' || typeof message.token !== 'string') return;

    handleAuth(ws, message.token);
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 'error' est toujours suivi de 'close', mais removeClient est idempotent.
  ws.on('error', () => removeClient(ws));
  ws.on('close', () => removeClient(ws));
}

// Vérifie que la classe rattachée au socket correspond toujours à la base : un
// élève déplacé ou supprimé ne doit pas continuer à recevoir les notifications
// de son ancienne classe jusqu'à l'expiration de son token.
async function revalidateClasse(ws) {
  try {
    const user = await db.get('SELECT classe_id FROM users WHERE id = ?', [ws.userId]);
    if (!user || user.classe_id !== ws.classeId) {
      ws.close(CLOSE_AUTH_FAILED, 'Classe modifiée');
    }
  } catch (error) {
    console.error('Erreur lors de la revalidation d\'un socket:', error);
  }
}

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

    if (!ws.classeId) return;

    if (ws.tokenExp && nowInSeconds > ws.tokenExp) {
      ws.close(CLOSE_TOKEN_EXPIRED, 'Token expiré');
      return;
    }

    // Le client répond à chaque battement : son silence prolongé signifie que son
    // JavaScript ne tourne plus (onglet gelé), même si la connexion TCP tient.
    if (Date.now() - ws.lastSeen > CLIENT_SILENCE_LIMIT_MS) {
      ws.close(CLOSE_CLIENT_SILENT, 'Client silencieux');
      return;
    }

    // Les navigateurs n'exposent pas les trames pong au JavaScript : sans cette
    // trame applicative, le chien de garde côté client n'aurait rien à observer.
    ws.send(JSON.stringify({ type: 'heartbeat' }));

    if (shouldRevalidate) revalidateClasse(ws);
  });
}

function init(server) {
  if (wss) return wss; // évite un double init (redémarrage nodemon)

  wss = new WebSocket.Server({
    server,
    path: '/ws',
    maxPayload: 4096 // le client n'envoie qu'une courte trame d'authentification
  });

  wss.on('connection', handleConnection);

  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  return wss;
}

// excludeClientId : connexion à l'origine de la modification, qui a déjà mis à
// jour son propre affichage et n'a donc rien à recharger.
function notifyClasse(classeId, message, excludeClientId = null) {
  if (classeId == null) return;

  const sockets = clientsByClasse.get(classeId);
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
  clientsByClasse.clear();
}

function getStats() {
  let sockets = 0;
  clientsByClasse.forEach((set) => {
    sockets += set.size;
  });
  return { classes: clientsByClasse.size, sockets };
}

module.exports = { init, notifyClasse, close, getStats };
