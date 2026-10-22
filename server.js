const express = require('express');
const path = require('path');
const http = require('http');
require('dotenv').config();

const realtime = require('./backend/services/realtime');
const realtimeNotifier = require('./backend/middleware/realtimeNotifier');

const app = express();
const server = http.createServer(app);

/**
 * The container only listens on 127.0.0.1 and Caddy is the only relay: one proxy
 * hop is trusted to read the real IP (rate limits).
 *
 * realtimeNotifier must be registered BEFORE the routers to wrap res.json; it reads
 * req.user lazily (in res.json), so after requireAuth.
 *
 * The comments router is mounted before /api/devoirs, whose requireAuth would
 * authenticate each request a second time. Attached files are only served through
 * a temporary link (backend/services/fileLinks.js). Front-end libraries are served
 * straight from node_modules.
 */
app.set('trust proxy', 1);
app.disable('x-powered-by');
realtime.init(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(realtimeNotifier);

require('./backend/models/database');

const { initScheduler } = require('./backend/services/scheduler');
initScheduler();

app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/superadmin', require('./backend/routes/superadmin'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/devoirs/:assignmentId/commentaires', require('./backend/routes/comments'));
app.use('/api/devoirs', require('./backend/routes/assignments'));
app.use('/api/invitations', require('./backend/routes/invitations'));
app.use('/api/quiz', require('./backend/routes/quiz'));
app.use('/api/registration', require('./backend/routes/registration'));
app.use('/api/proxy', require('./backend/routes/proxy'));
app.use('/api/mcp', require('./backend/routes/mcp'));
app.use('/api/push', require('./backend/routes/push'));
app.use('/api/calendar', require('./backend/routes/calendar'));
app.use('/api/emploi-temps', require('./backend/routes/timetable'));
app.use('/api/fichiers', require('./backend/routes/files'));

app.use(express.static(path.join(__dirname, 'public')));
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

app.get('/emploi-du-temps', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'emploi-du-temps', 'index.html'));
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
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'production'}`);
});

process.on('SIGTERM', () => {
  realtime.close();
  server.close(() => process.exit(0));
});
