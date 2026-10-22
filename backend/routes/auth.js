const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/dbHelper');
const {requireAuth, verifyToken} = require("../middleware/auth");
const mcpTokens = require('../services/mcpTokens');
const { loginLimiter } = require('../middleware/rateLimit');
const router = express.Router();

const { JWT_SECRET } = require('../config/jwt');
const JWT_EXPIRES_IN = '3650d';
/**
 * Compared when the username is unknown, so the response time does not reveal
 * which accounts exist (same cost as the real hashes).
 */
const DUMMY_HASH = bcrypt.hashSync('compte-inexistant', 10);

/** Logs in with a username or an email. */
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }

  try {
    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [username, username]
    );

    const validPassword = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !validPassword) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      token: token,
      role: user.role,
      username: user.username,
      userId: user.id
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Nothing to do on the server side: the client deletes the token. */
router.post('/logout', (req, res) => {
  res.json({ success: true });
});

/**
 * Checks the token and returns the user info. A 401 without an "error" field makes
 * checkAuth() (public/js/utils/api.js) log out and redirect.
 */
router.get('/me', async (req, res) => {
  let user;
  try {
    user = await verifyToken(req);
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  if (!user) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    let pendingRequest = null;
    if (!user.classe_id && user.role === 'eleve') {
      pendingRequest = await db.get(
        `SELECT jr.id, jr.status, c.nom AS classe_nom
         FROM join_requests jr
         JOIN classes c ON jr.classe_id = c.id
         WHERE jr.user_id = ? AND jr.status = 'pending'
         ORDER BY jr.created_at DESC
         LIMIT 1`,
        [user.id]
      );
    }

    res.json({
      authenticated: true,
      userId: user.id,
      username: user.username,
      role: user.role,
      classe_id: user.classe_id || null,
      is_admin: user.role === 'admin',
      pending_request: pendingRequest
        ? {
            id: pendingRequest.id,
            status: pendingRequest.status,
            classe_nom: pendingRequest.classe_nom
          }
        : null
    });
  } catch (error) {
    console.error('Error fetching user info in /me:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
  }

  try {
    const validPassword = await bcrypt.compare(oldPassword, req.user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du mot de passe' });
  }
});

router.post('/update-info', requireAuth, async (req, res) => {
  const { email, nom: lastName, prenom: firstName } = req.body || {};

  if (!email || !lastName || !firstName) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format d\'email invalide' });
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.session.userId]);
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    await db.run('UPDATE users SET email = ?, nom = ?, prenom = ? WHERE id = ?', [email, lastName, firstName, req.session.userId]);

    res.json({ success: true, message: 'Informations mises à jour avec succès' });
  } catch (error) {
    console.error('Error updating user info:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des informations' });
  }
});

router.get('/user-info', requireAuth, async (req, res) => {
  try {
    const user = await db.get('SELECT email, nom, prenom FROM users WHERE id = ?', [req.session.userId]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des informations' });
  }
});

/**
 * Validates the MCP token name and expiry sent by the settings page (MCP tokens
 * give AI assistants access to the assignments, see routes/mcp.js).
 * expires_at: ISO date (end of the chosen day, browser local time) or null.
 */
function parseMcpTokenBody(body) {
  const name = typeof body.nom === 'string' ? body.nom.trim() : '';
  if (!name || name.length > 100) {
    return { error: 'Nom requis (100 caractères maximum)' };
  }

  if (body.expires_at === null || body.expires_at === undefined || body.expires_at === '') {
    return { name, expiresAt: null };
  }
  const date = new Date(body.expires_at);
  if (Number.isNaN(date.getTime())) {
    return { error: "Date d'expiration invalide" };
  }
  if (date.getTime() <= Date.now()) {
    return { error: "La date d'expiration doit être dans le futur" };
  }
  return { name, expiresAt: date.toISOString().slice(0, 19).replace('T', ' ') };
}

router.get('/mcp-tokens', requireAuth, async (req, res) => {
  try {
    const tokens = await mcpTokens.listTokens(req.session.userId);
    res.json(tokens.map(t => ({ ...t, expired: Boolean(t.expired) })));
  } catch (error) {
    console.error('Error listing MCP tokens:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des liens' });
  }
});

/** The token is only sent back here, once. */
router.post('/mcp-tokens', requireAuth, express.json(), async (req, res) => {
  const parsed = parseMcpTokenBody(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    if (await mcpTokens.countTokens(req.session.userId) >= mcpTokens.MAX_TOKENS_PER_USER) {
      return res.status(400).json({ error: `${mcpTokens.MAX_TOKENS_PER_USER} liens maximum : révoquez-en un d'abord` });
    }
    const { id, token } = await mcpTokens.createToken(req.session.userId, parsed);
    res.json({ success: true, id, token });
  } catch (error) {
    console.error('Error creating MCP token:', error);
    res.status(500).json({ error: 'Erreur lors de la création du lien' });
  }
});

router.put('/mcp-tokens/:id', requireAuth, express.json(), async (req, res) => {
  const parsed = parseMcpTokenBody(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    if (!await mcpTokens.updateToken(req.session.userId, req.params.id, parsed)) {
      return res.status(404).json({ error: 'Lien introuvable' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating MCP token:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du lien' });
  }
});

router.delete('/mcp-tokens/:id', requireAuth, async (req, res) => {
  try {
    if (!await mcpTokens.revokeToken(req.session.userId, req.params.id)) {
      return res.status(404).json({ error: 'Lien introuvable' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking MCP token:', error);
    res.status(500).json({ error: 'Erreur lors de la révocation du lien' });
  }
});

module.exports = router;
