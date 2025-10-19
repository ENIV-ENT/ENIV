const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const router = express.Router();

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

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({
      success: true,
      role: user.role,
      username: user.username,
      userId: user.id
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
    res.json({ success: true });
  });
});

// Check session
router.get('/me', (req, res) => {
  if (req.session.userId) {
    res.json({
      authenticated: true,
      userId: req.session.userId,
      username: req.session.username,
      role: req.session.role
    });
  } else {
    res.json({ authenticated: false });
  }
});

router.post('/change-password', async (req, res) => {
  if (!req.session.userId) {
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
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const validPassword = bcrypt.compareSync(oldPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du mot de passe' });
  }
});

// Update user information
router.post('/update-info', async (req, res) => {
  if (!req.session.userId) {
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
    const existingUser = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.session.userId]);
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    await db.run('UPDATE users SET email = ?, nom = ?, prenom = ? WHERE id = ?', [email, nom, prenom, req.session.userId]);

    res.json({ success: true, message: 'Informations mises à jour avec succès' });
  } catch (error) {
    console.error('Error updating user info:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des informations' });
  }
});

// Get user information
router.get('/user-info', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

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

module.exports = router;
