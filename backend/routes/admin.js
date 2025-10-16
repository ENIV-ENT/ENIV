const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Palette de couleurs prédéfinies
const availableColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
  '#EC7063', '#5DADE2', '#F39C12', '#AF7AC5', '#48C9B0',
  '#E74C3C', '#3498DB', '#2ECC71', '#E67E22', '#9B59B6',
  '#1ABC9C', '#34495E', '#16A085', '#27AE60', '#2980B9',
  '#8E44AD', '#2C3E50', '#F1C40F', '#E08E79', '#73C6B6'
];

// Fonction pour obtenir une couleur unique
function getUniqueColor() {
  try {
    const usedColors = db.prepare('SELECT couleur FROM matieres WHERE couleur IS NOT NULL').all();
    const usedSet = new Set(usedColors.map(m => m.couleur));

    const available = availableColors.filter(color => !usedSet.has(color));

    if (available.length === 0) {
      // Si toutes les couleurs sont utilisées, générer une couleur aléatoire
      return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    }

    // Retourner une couleur aléatoire parmi celles disponibles
    return available[Math.floor(Math.random() * available.length)];
  } catch (error) {
    console.error('Error getting unique color:', error);
    return availableColors[0];
  }
}

// Changer le mot de passe de l'admin
router.post('/change-password', requireAdmin, express.json(), (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
  }

  try {
    // Récupérer le mot de passe actuel de l'admin
    const admin = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.session.userId, 'admin');

    if (!admin) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier l'ancien mot de passe
    const validPassword = bcrypt.compareSync(oldPassword, admin.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    // Mettre à jour le mot de passe
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du mot de passe' });
  }
});

// Créer un élève
router.post('/eleves', requireAdmin, express.json(), (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username et password requis' });
  }

  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, role, classe_id) VALUES (?, ?, ?, ?)').run(username, hashedPassword, 'eleve', admin.classe_id);

    res.json({
      success: true,
      eleveId: result.lastInsertRowid,
      message: 'Élève créé avec succès'
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de la création de l\'élève' });
    }
  }
});

// Lister tous les élèves
router.get('/eleves', requireAdmin, (req, res) => {
  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const eleves = db.prepare('SELECT id, username, created_at FROM users WHERE role = ? AND classe_id = ?').all('eleve', admin.classe_id);
    res.json(eleves);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des élèves' });
  }
});

// Modifier un élève (username et/ou mot de passe)
router.put('/eleves/:id', requireAdmin, express.json(), (req, res) => {
  const { username, password } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Nom d\'utilisateur requis' });
  }

  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    if (password) {
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET username = ?, password = ? WHERE id = ? AND role = ? AND classe_id = ?').run(username, hashedPassword, req.params.id, 'eleve', admin.classe_id);
    } else {
      db.prepare('UPDATE users SET username = ? WHERE id = ? AND role = ? AND classe_id = ?').run(username, req.params.id, 'eleve', admin.classe_id);
    }
    res.json({ success: true, message: 'Élève modifié avec succès' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de la modification de l\'élève' });
    }
  }
});

// Supprimer un élève
router.delete('/eleves/:id', requireAdmin, (req, res) => {
  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    db.prepare('DELETE FROM users WHERE id = ? AND role = ? AND classe_id = ?').run(req.params.id, 'eleve', admin.classe_id);
    res.json({ success: true, message: 'Élève supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'élève' });
  }
});

// Créer une matière
router.post('/matieres', requireAdmin, express.json(), (req, res) => {
  const { nom, lien, couleur } = req.body;

  if (!nom) {
    return res.status(400).json({ error: 'Nom de matière requis' });
  }

  if (!couleur || couleur.trim() === '') {
    return res.status(400).json({ error: 'Couleur de matière requise' });
  }

  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const result = db.prepare('INSERT INTO matieres (nom, lien, couleur, classe_id) VALUES (?, ?, ?, ?)').run(nom, lien || null, couleur, admin.classe_id);

    res.json({
      success: true,
      matiereId: result.lastInsertRowid,
      message: 'Matière créée avec succès'
    });
  } catch (error) {
    console.error('Erreur création matière:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la matière' });
  }
});

// Lister toutes les matières (accessible à tous les utilisateurs authentifiés)
router.get('/matieres', requireAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !user.classe_id) {
      return res.json([]);
    }

    const matieres = db.prepare('SELECT * FROM matieres WHERE classe_id = ? ORDER BY nom').all(user.classe_id);
    res.json(matieres);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des matières' });
  }
});

// Modifier une matière
router.put('/matieres/:id', requireAdmin, express.json(), (req, res) => {
  const { nom, lien, couleur } = req.body;

  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    db.prepare('UPDATE matieres SET nom = ?, lien = ?, couleur = ? WHERE id = ? AND classe_id = ?').run(nom, lien || null, couleur || null, req.params.id, admin.classe_id);
    res.json({ success: true, message: 'Matière mise à jour' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la matière' });
  }
});

// Supprimer une matière
router.delete('/matieres/:id', requireAdmin, (req, res) => {
  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    db.prepare('DELETE FROM matieres WHERE id = ? AND classe_id = ?').run(req.params.id, admin.classe_id);
    res.json({ success: true, message: 'Matière supprimée' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de la matière' });
  }
});

// Configurer le lien emploi du temps
router.post('/settings/emploi-temps', requireAdmin, express.json(), (req, res) => {
  const { lien } = req.body;

  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const key = `emploi_temps_lien_${admin.classe_id}`;
    db.prepare('INSERT OR REPLACE INTO settings (key, value, classe_id) VALUES (?, ?, ?)').run(key, lien || null, admin.classe_id);
    res.json({ success: true, message: 'Lien emploi du temps configuré' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la configuration' });
  }
});

// Récupérer le lien emploi du temps
router.get('/settings/emploi-temps', requireAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !user.classe_id) {
      return res.json({ lien: null });
    }

    const key = `emploi_temps_lien_${user.classe_id}`;
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    res.json({ lien: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Configurer le webhook Discord
router.post('/settings/discord-webhook', requireAdmin, express.json(), (req, res) => {
  const { webhook } = req.body;

  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    // Valider le format du webhook Discord
    if (webhook && !webhook.match(/^https:\/\/discord\.com\/api\/webhooks\/.+/)) {
      return res.status(400).json({ error: 'URL de webhook Discord invalide' });
    }

    const key = `discord_webhook_${admin.classe_id}`;
    db.prepare('INSERT OR REPLACE INTO settings (key, value, classe_id) VALUES (?, ?, ?)').run(key, webhook || null, admin.classe_id);
    res.json({ success: true, message: 'Webhook Discord configuré' });
  } catch (error) {
    console.error('Error configuring Discord webhook:', error);
    res.status(500).json({ error: 'Erreur lors de la configuration du webhook' });
  }
});

// Récupérer le webhook Discord
router.get('/settings/discord-webhook', requireAdmin, (req, res) => {
  try {
    const admin = db.prepare('SELECT classe_id FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || !admin.classe_id) {
      return res.json({ webhook: null });
    }

    const key = `discord_webhook_${admin.classe_id}`;
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    res.json({ webhook: setting ? setting.value : null });
  } catch (error) {
    console.error('Error retrieving Discord webhook:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du webhook' });
  }
});

module.exports = router;
