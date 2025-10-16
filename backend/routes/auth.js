const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/database');
const router = express.Router();

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

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

router.post('/change-password', (req, res) => {
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
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const validPassword = bcrypt.compareSync(oldPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du mot de passe' });
  }
});

module.exports = router;
