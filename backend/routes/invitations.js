const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const { sendInvitationEmail } = require('../services/email');
const { requireAuth, requireAdminOrSuperAdmin } = require('../middleware/auth');
const { signupLimiter, lookupLimiter } = require('../middleware/rateLimit');
const router = express.Router();

/**
 * Creates an invitation (admin or superadmin). Without the middleware role check,
 * a student could invite themselves (or a third party) into any class by passing
 * its classe_id. An admin can only invite into their own class. The invitation
 * lasts 7 days and is deleted if the email cannot be sent.
 */
router.post('/create', requireAdminOrSuperAdmin, async (req, res) => {
  const { email, role, classe_id: requestedClassId } = req.body || {};
  const creatorRole = req.session.role;

  if (!email || !role) {
    return res.status(400).json({ error: 'Email et rôle requis' });
  }

  if (creatorRole === 'admin' && role !== 'eleve') {
    return res.status(403).json({ error: 'Un admin ne peut créer que des comptes élèves' });
  }

  if (creatorRole === 'superadmin' && role !== 'admin') {
    return res.status(403).json({ error: 'Un superadmin ne peut créer que des comptes admin' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format d\'email invalide' });
  }

  try {
    let finalClassId = requestedClassId;
    if (creatorRole === 'admin') {
      finalClassId = req.user.classe_id;
    }

    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà associé à un compte' });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const existingInvitation = await db.get(
      'SELECT id FROM invitations WHERE email = ? AND used = 0 AND expires_at > ?',
      [email, now]
    );

    if (existingInvitation) {
      return res.status(400).json({ error: 'Une invitation est déjà en attente pour cet email' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const mysqlDateTime = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

    const result = await db.run(
      'INSERT INTO invitations (email, token, role, classe_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [email, token, role, finalClassId || null, req.session.userId, mysqlDateTime]
    );

    let className = null;
    if (finalClassId) {
      const schoolClass = await db.get('SELECT nom FROM classes WHERE id = ?', [finalClassId]);
      className = schoolClass ? schoolClass.nom : null;
    }

    try {
      await sendInvitationEmail(email, token, role, className);
      res.json({
        success: true,
        message: 'Invitation envoyée avec succès',
        invitationId: result.lastInsertRowid
      });
    } catch (emailError) {
      await db.run('DELETE FROM invitations WHERE id = ?', [result.lastInsertRowid]);
      throw emailError;
    }
  } catch (error) {
    console.error('Error creating invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'invitation' });
  }
});

router.get('/verify/:token', lookupLimiter, async (req, res) => {
  const { token } = req.params;

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const invitation = await db.get(
      `SELECT i.*, c.nom as classe_nom
       FROM invitations i
       LEFT JOIN classes c ON i.classe_id = c.id
       WHERE i.token = ? AND i.used = 0 AND i.expires_at > ?`,
      [token, now]
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation invalide ou expirée' });
    }

    res.json({
      valid: true,
      email: invitation.email,
      role: invitation.role,
      classe: invitation.classe_nom
    });
  } catch (error) {
    console.error('Error verifying invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la vérification de l\'invitation' });
  }
});

router.post('/check-username', lookupLimiter, async (req, res) => {
  const { username } = req.body || {};

  if (!username) {
    return res.status(400).json({ error: 'Nom d\'utilisateur requis' });
  }

  if (username.length < 3) {
    return res.json({ available: false, message: 'Le nom d\'utilisateur doit contenir au moins 3 caractères' });
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);

    if (existingUser) {
      return res.json({ available: false, message: 'Ce nom d\'utilisateur est déjà utilisé' });
    }

    res.json({ available: true, message: 'Ce nom d\'utilisateur est disponible' });
  } catch (error) {
    console.error('Error checking username:', error);
    res.status(500).json({ error: 'Erreur lors de la vérification du nom d\'utilisateur' });
  }
});

/**
 * Completes the signup with an invitation. The password is hashed before opening
 * the transaction: no need to hold a MySQL connection while hashing.
 */
router.post('/complete', signupLimiter, async (req, res) => {
  const { token, username, password, nom: lastName, prenom: firstName } = req.body || {};

  if (!token || !username || !password || !lastName || !firstName) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Le nom d\'utilisateur doit contenir au moins 3 caractères' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
  }

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const invitation = await db.get(
      'SELECT * FROM invitations WHERE token = ? AND used = 0 AND expires_at > ?',
      [token, now]
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation invalide ou expirée' });
    }

    const existingUser = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }

    const emailUser = await db.get('SELECT id FROM users WHERE email = ?', [invitation.email]);
    if (emailUser) {
      return res.status(400).json({ error: 'Cet email est déjà associé à un compte' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userId = await db.transaction(async (connection) => {
      const [result] = await connection.query(
        'INSERT INTO users (username, password, email, nom, prenom, role, classe_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, hashedPassword, invitation.email, lastName, firstName, invitation.role, invitation.classe_id]
      );

      await connection.query('DELETE FROM invitations WHERE id = ?', [invitation.id]);

      return result.insertId;
    });

    res.json({
      success: true,
      message: 'Compte créé avec succès',
      userId
    });
  } catch (error) {
    console.error('Error completing invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

router.get('/list', requireAdminOrSuperAdmin, async (req, res) => {
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const invitations = await db.all(
      `SELECT i.*, c.nom as classe_nom, u.username as created_by_username
       FROM invitations i
       LEFT JOIN classes c ON i.classe_id = c.id
       LEFT JOIN users u ON i.created_by = u.id
       WHERE i.created_by = ? AND i.used = 0 AND i.expires_at > ?
       ORDER BY i.created_at DESC`,
      [req.session.userId, now]
    );

    res.json(invitations);
  } catch (error) {
    console.error('Error listing invitations:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des invitations' });
  }
});

router.post('/resend/:id', requireAuth, async (req, res) => {

  const { id } = req.params;

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const invitation = await db.get(
      `SELECT i.*, c.nom as classe_nom
       FROM invitations i
       LEFT JOIN classes c ON i.classe_id = c.id
       WHERE i.id = ? AND i.created_by = ? AND i.used = 0 AND i.expires_at > ?`,
      [id, req.session.userId, now]
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation non trouvée ou déjà utilisée' });
    }

    await sendInvitationEmail(invitation.email, invitation.token, invitation.role, invitation.classe_nom);

    res.json({
      success: true,
      message: 'Email d\'invitation renvoyé avec succès'
    });
  } catch (error) {
    console.error('Error resending invitation:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'invitation' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {

  const { id } = req.params;

  try {
    const invitation = await db.get(
      'SELECT id FROM invitations WHERE id = ? AND created_by = ?',
      [id, req.session.userId]
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation non trouvée' });
    }

    await db.run('DELETE FROM invitations WHERE id = ?', [id]);

    res.json({ success: true, message: 'Invitation supprimée' });
  } catch (error) {
    console.error('Error deleting invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'invitation' });
  }
});

module.exports = router;
