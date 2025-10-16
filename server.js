const express = require('express');
const session = require('express-session');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration session
app.use(session({
  secret: process.env.SESSION_SECRET || 'ENT-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 1 jour
  }
}));

// Initialiser la base de données
require('./backend/models/database');

// Routes
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/devoirs', require('./backend/routes/devoirs'));

// Route pour le webhook GitHub
const { handleWebhook } = require('./deploy');
app.post('/api/deploy', handleWebhook);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'backend/uploads')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard', 'index.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings', 'index.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard', 'index.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ws') && !req.path.startsWith('/js') && !req.path.startsWith('/css') && !req.path.startsWith('/uploads')) {
    res.redirect('/login');
  }
});

// WebSocket pour rechargement automatique
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
  });
});

function notifyClients(message) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && data.success) {
      notifyClients({ type: 'update', path: req.path });
    }
    originalJson.call(this, data);
  };
  next();
});

const PORT = process.env.NODE_ENV === 'development' ? 3000 : 3650;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'production'}`);
});
