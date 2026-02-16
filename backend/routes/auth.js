const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/dbHelper');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '30d'; // Le token expire dans 30 jours

// Helper pour extraire le user depuis le token
const getUserFromToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Rechercher l'utilisateur par username OU par email
    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [username, username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // Générer le JWT
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role
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

// Logout (côté serveur, rien à faire - le client supprime le token)
router.post('/logout', (req, res) => {
  res.json({ success: true });
});

// Check token / Get user info from token
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ authenticated: false });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Enrichir avec les infos DB
    const user = await db.get(
      `SELECT u.id, u.username, u.role, u.classe_id, u.nom, u.prenom,
        c.nom as classe_nom, c.admin_id as classe_admin_id
       FROM users u
       LEFT JOIN classes c ON u.classe_id = c.id
       WHERE u.id = ?`,
      [decoded.userId]
    );

    if (!user) {
      return res.json({ authenticated: false });
    }

    const isAdmin = user.role === 'admin';

    // Vérifier si l'utilisateur a une demande en attente
    let pendingRequest = null;
    if (!user.classe_id && user.role === 'eleve') {
      pendingRequest = await db.get(
        `SELECT jr.id, jr.status, c.nom as classe_nom
         FROM join_requests jr
         JOIN classes c ON jr.classe_id = c.id
         WHERE jr.user_id = ? AND jr.status = 'pending'`,
        [user.id]
      );
    }

    res.json({
      authenticated: true,
      userId: user.id,
      username: user.username,
      role: user.role,
      nom: user.nom,
      prenom: user.prenom,
      classe_id: user.classe_id,
      classe_nom: user.classe_nom,
      is_admin: isAdmin,
      pending_request: pendingRequest
    });
  } catch (error) {
    res.json({ authenticated: false });
  }
});

router.post('/change-password', async (req, res) => {
  const userToken = getUserFromToken(req);
  if (!userToken) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userToken.userId]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const validPassword = bcrypt.compareSync(oldPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userToken.userId]);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du mot de passe' });
  }
});

// Update user information
router.post('/update-info', async (req, res) => {
  const userToken = getUserFromToken(req);
  if (!userToken) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const { email, nom, prenom } = req.body;

  if (!email || !nom || !prenom) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  // Validation de l'email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format d\'email invalide' });
  }

  try {
    // Vérifier si l'email existe déjà pour un autre utilisateur
    const existingUser = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, userToken.userId]);
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    await db.run('UPDATE users SET email = ?, nom = ?, prenom = ? WHERE id = ?', [email, nom, prenom, userToken.userId]);

    res.json({ success: true, message: 'Informations mises à jour avec succès' });
  } catch (error) {
    console.error('Error updating user info:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des informations' });
  }
});

// Get user information
router.get('/user-info', async (req, res) => {
  const userToken = getUserFromToken(req);
  if (!userToken) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    const user = await db.get('SELECT email, nom, prenom FROM users WHERE id = ?', [userToken.userId]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des informations' });
  }
});

module.exports = router;
