const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const { sendInvitationEmail } = require('../services/email');
const { createInvitation } = require('../services/invitations');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

const MAX_BULK_INVITATIONS = 100;

// Message renvoyé à l'invitation individuelle pour chaque refus « métier »
const INVITATION_ERRORS = {
  invalide: 'Format d\'email invalide',
  deja_inscrit: 'Cet email est déjà associé à un compte',
  deja_invite: 'Une invitation est déjà en attente pour cet email'
};

// Créer une invitation (Admin ou Superadmin)
router.post('/create', requireAuth, async (req, res) => {
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

  try {
    // Un admin invite toujours dans sa propre classe
    const classeId = creatorRole === 'admin' ? req.user.classe_id : classe_id;
    const result = await createInvitation({ email, role, classeId, createdBy: req.session.userId });

    if (result.status !== 'envoyee') {
      return res.status(400).json({ error: INVITATION_ERRORS[result.status] });
    }
    res.json({
      success: true,
      message: 'Invitation envoyée avec succès',
      invitationId: result.invitationId
    });
  } catch (error) {
    console.error('Error creating invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'invitation' });
  }
});

// Inviter plusieurs élèves d'un coup (admin) : chaque adresse reçoit un statut,
// une adresse déjà inscrite ou invitée n'interrompt pas les suivantes.
router.post('/bulk', requireAdmin, async (req, res) => {
  const emails = Array.isArray(req.body?.emails) ? req.body.emails : null;
  if (!emails || emails.length === 0) {
    return res.status(400).json({ error: 'Liste d\'adresses requise' });
  }

  // Doublons retirés, casse ignorée
  const uniques = [...new Set(emails
    .filter((email) => typeof email === 'string')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];

  if (uniques.length > MAX_BULK_INVITATIONS) {
    return res.status(400).json({ error: `${MAX_BULK_INVITATIONS} adresses maximum par envoi` });
  }

  const results = [];
  // Envoi un par un : le fournisseur d'e-mails limite le débit
  for (const email of uniques) {
    try {
      const result = await createInvitation({
        email,
        role: 'eleve',
        classeId: req.user.classe_id,
        createdBy: req.user.id
      });
      results.push({ email, status: result.status });
    } catch (error) {
      console.error(`Error inviting ${email}:`, error);
      results.push({ email, status: 'erreur' });
    }
  }

  const envoyees = results.filter((r) => r.status === 'envoyee').length;
  res.json({ success: true, envoyees, total: results.length, results });
});

// Vérifier la validité d'une invitation
router.get('/verify/:token', async (req, res) => {
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

// Vérifier la disponibilité d'un username
router.post('/check-username', async (req, res) => {
  const { username } = req.body;

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

// Finaliser l'inscription avec une invitation
router.post('/complete', async (req, res) => {
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
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const invitation = await db.get(
      'SELECT * FROM invitations WHERE token = ? AND used = 0 AND expires_at > ?',
      [token, now]
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation invalide ou expirée' });
    }

    // Vérifier si le username est disponible
    const existingUser = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }

    // Vérifier si l'email n'est pas déjà utilisé
    const emailUser = await db.get('SELECT id FROM users WHERE email = ?', [invitation.email]);
    if (emailUser) {
      return res.status(400).json({ error: 'Cet email est déjà associé à un compte' });
    }

    // Créer le compte dans une transaction
    const userId = await db.transaction(async (connection) => {
      // Hasher le mot de passe
      const hashedPassword = bcrypt.hashSync(password, 10);

      // Créer l'utilisateur
      const [result] = await connection.query(
        'INSERT INTO users (username, password, email, nom, prenom, role, classe_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, hashedPassword, invitation.email, nom, prenom, invitation.role, invitation.classe_id]
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

// Lister les invitations (Admin/Superadmin)
router.get('/list', requireAuth, async (req, res) => {
  const role = req.session.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

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

// Renvoyer une invitation
router.post('/resend/:id', requireAuth, async (req, res) => {

  const { id } = req.params;

  try {
    // Récupérer l'invitation
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

    // Renvoyer l'email
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

// Supprimer une invitation
router.delete('/:id', requireAuth, async (req, res) => {

  const { id } = req.params;

  try {
    // Vérifier que l'invitation appartient bien à l'utilisateur
    const invitation = await db.get(
      'SELECT id FROM invitations WHERE id = ? AND created_by = ?',
      [id, req.session.userId]
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation non trouvée' });
    }

    // Supprimer l'invitation
    await db.run('DELETE FROM invitations WHERE id = ?', [id]);

    res.json({ success: true, message: 'Invitation supprimée' });
  } catch (error) {
    console.error('Error deleting invitation:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'invitation' });
  }
});

module.exports = router;
