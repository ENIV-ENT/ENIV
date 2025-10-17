const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../models/database');
const { sendInvitationEmail } = require('../services/email');
const router = express.Router();

// Créer une invitation (Admin ou Superadmin)
router.post('/create', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const { email, role, classe_id } = req.body;
  const creatorRole = req.session.role;

  // Validation des permissions
  if (creatorRole === 'admin' && role !== 'eleve') {
    return res.status(403).json({ error: 'Un admin ne peut créer que des comptes élèves' });
  }

  if (creatorRole === 'superadmin' && role !== 'admin') {
    return res.status(403).json({ error: 'Un superadmin ne peut créer que des comptes admin' });
  }

  if (!email || !role) {
    return res.status(400).json({ error: 'Email et rôle requis' });
  }

  // Validation de l'email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format d\'email invalide' });
  }

  try {
    // Vérifier si l'email existe déjà
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà associé à un compte' });
    }

    // Vérifier si une invitation active existe déjà
    const existingInvitation = db.prepare(
      "SELECT id FROM invitations WHERE email = ? AND used = 0 AND expires_at > datetime('now')"
    ).get(email);

    if (existingInvitation) {
      return res.status(400).json({ error: 'Une invitation est déjà en attente pour cet email' });
    }

    // Générer un token unique
    const token = crypto.randomBytes(32).toString('hex');

    // Date d'expiration (7 jours)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Créer l'invitation
    const result = db.prepare(`
      INSERT INTO invitations (email, token, role, classe_id, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email, token, role, classe_id || null, req.session.userId, expiresAt.toISOString());

    // Récupérer le nom de la classe si applicable
    let className = null;
    if (classe_id) {
      const classe = db.prepare('SELECT nom FROM classes WHERE id = ?').get(classe_id);
      className = classe ? classe.nom : null;
    }

    // Envoyer l'email d'invitation
    try {
      await sendInvitationEmail(email, token, role, className);
      res.json({
        success: true,
        message: 'Invitation envoyée avec succès',
        invitationId: result.lastInsertRowid
      });
    } catch (emailError) {
      // Supprimer l'invitation si l'email n'a pas pu être envoyé
      db.prepare('DELETE FROM invitations WHERE id = ?').run(result.lastInsertRowid);
      throw emailError;
    }
  } catch (error) {
    console.error('Error creating invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'invitation' });
  }
});

// Vérifier la validité d'une invitation
router.get('/verify/:token', (req, res) => {
  const { token } = req.params;

  try {
    const invitation = db.prepare(`
      SELECT i.*, c.nom as classe_nom
      FROM invitations i
      LEFT JOIN classes c ON i.classe_id = c.id
      WHERE i.token = ? AND i.used = 0 AND i.expires_at > datetime('now')
    `).get(token);

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

// Vérifier la disponibilité d'un username
router.post('/check-username', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Nom d\'utilisateur requis' });
  }

  if (username.length < 3) {
    return res.json({ available: false, message: 'Le nom d\'utilisateur doit contenir au moins 3 caractères' });
  }

  try {
    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);

    if (existingUser) {
      return res.json({ available: false, message: 'Ce nom d\'utilisateur est déjà utilisé' });
    }

    res.json({ available: true, message: 'Ce nom d\'utilisateur est disponible' });
  } catch (error) {
    console.error('Error checking username:', error);
    res.status(500).json({ error: 'Erreur lors de la vérification du nom d\'utilisateur' });
  }
});

// Finaliser l'inscription avec une invitation
router.post('/complete', (req, res) => {
  const { token, username, password, nom, prenom } = req.body;

  if (!token || !username || !password || !nom || !prenom) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Le nom d\'utilisateur doit contenir au moins 3 caractères' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
  }

  try {
    // Vérifier l'invitation
    const invitation = db.prepare(`
      SELECT * FROM invitations
      WHERE token = ? AND used = 0 AND expires_at > datetime('now')
    `).get(token);

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation invalide ou expirée' });
    }

    // Vérifier si le username est disponible
    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }

    // Vérifier si l'email n'est pas déjà utilisé
    const emailUser = db.prepare('SELECT id FROM users WHERE email = ?').get(invitation.email);
    if (emailUser) {
      return res.status(400).json({ error: 'Cet email est déjà associé à un compte' });
    }

    // Créer le compte dans une transaction
    const transaction = db.transaction(() => {
      // Hasher le mot de passe
      const hashedPassword = bcrypt.hashSync(password, 10);

      // Créer l'utilisateur
      const result = db.prepare(`
        INSERT INTO users (username, password, email, nom, prenom, role, classe_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(username, hashedPassword, invitation.email, nom, prenom, invitation.role, invitation.classe_id);

      // Marquer l'invitation comme utilisée
      db.prepare(`
        UPDATE invitations
        SET used = 1, used_at = datetime('now')
        WHERE id = ?
      `).run(invitation.id);

      return result.lastInsertRowid;
    });

    const userId = transaction();

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

// Lister les invitations (Admin/Superadmin)
router.get('/list', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const role = req.session.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const invitations = db.prepare(`
      SELECT i.*, c.nom as classe_nom, u.username as created_by_username
      FROM invitations i
      LEFT JOIN classes c ON i.classe_id = c.id
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.created_by = ?
      ORDER BY i.created_at DESC
    `).all(req.session.userId);

    res.json(invitations);
  } catch (error) {
    console.error('Error listing invitations:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des invitations' });
  }
});

module.exports = router;
