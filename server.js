const express = require('express');
const session = require('express-session');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuration session
app.use(session({
  secret: 'ent-leger-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 24 heures
  }
}));

// Initialiser la base de données
require('./backend/models/database');

// Routes
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/devoirs', require('./backend/routes/devoirs'));

// WebSocket pour rechargement automatique
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Fonction pour notifier tous les clients
function notifyClients(message) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Middleware pour notifier les changements
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    // Notifier les clients après modification de données
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && data.success) {
      notifyClients({ type: 'update', path: req.path });
    }
    originalJson.call(this, data);
  };
  next();
});

// Route principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log('Admin par défaut: username=admin, password=admin123');
});
