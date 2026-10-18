const express = require('express');
const path = require('path');
const http = require('http');
require('dotenv').config();

const realtime = require('./backend/services/realtime');
const realtimeNotifier = require('./backend/middleware/realtimeNotifier');

const app = express();
const server = http.createServer(app);
realtime.init(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Doit être enregistré AVANT les routeurs pour pouvoir envelopper res.json ;
// il lit req.user paresseusement (dans res.json), donc après requireAuth.
app.use(realtimeNotifier);

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
app.use('/api/proxy', require('./backend/routes/proxy'));
app.use('/api/mcp', require('./backend/routes/mcp'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'backend/uploads')));
// Bibliothèques front servies directement depuis node_modules
app.use('/vendor/markdown-it', express.static(path.join(__dirname, 'node_modules/markdown-it/dist/browser')));

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
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.NODE_ENV === 'development' ? 3000 : 3650;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'production'}`);
});

process.on('SIGTERM', () => {
  realtime.close();
  server.close(() => process.exit(0));
});
