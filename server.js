const express = require('express');
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

// Initialiser la base de données
require('./backend/models/database');

// Initialiser le planificateur Discord
const { initScheduler } = require('./backend/services/scheduler');
initScheduler();

// Routes
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/superadmin', require('./backend/routes/superadmin'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/devoirs', require('./backend/routes/devoirs'));
app.use('/api/invitations', require('./backend/routes/invitations'));
app.use('/api/quiz', require('./backend/routes/quiz'));
app.use('/api/registration', require('./backend/routes/registration'));

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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.redirect('/admin');
});

app.get('/superadmin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'superadmin', 'dashboard', 'index.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register', 'index.html'));
});

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz', 'index.html'));
});

app.get('/devoir-pdf', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'devoir-pdf', 'index.html'));
});

app.get('/*splat', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ws') && !req.path.startsWith('/js') && !req.path.startsWith('/css') && !req.path.startsWith('/uploads')) {
    res.redirect('/');
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
