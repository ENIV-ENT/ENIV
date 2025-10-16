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
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashedPassword, 'eleve');

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
    const eleves = db.prepare('SELECT id, username, created_at FROM users WHERE role = ?').all('eleve');
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
    // Si un mot de passe est fourni, le modifier aussi
    if (password) {
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET username = ?, password = ? WHERE id = ? AND role = ?').run(username, hashedPassword, req.params.id, 'eleve');
    } else {
      db.prepare('UPDATE users SET username = ? WHERE id = ? AND role = ?').run(username, req.params.id, 'eleve');
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
    db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(req.params.id, 'eleve');
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
    const result = db.prepare('INSERT INTO matieres (nom, lien, couleur) VALUES (?, ?, ?)').run(nom, lien || null, couleur);

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
    const matieres = db.prepare('SELECT * FROM matieres ORDER BY nom').all();
    res.json(matieres);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des matières' });
  }
});

// Modifier une matière
router.put('/matieres/:id', requireAdmin, express.json(), (req, res) => {
  const { nom, lien, couleur } = req.body;

  try {
    db.prepare('UPDATE matieres SET nom = ?, lien = ?, couleur = ? WHERE id = ?').run(nom, lien || null, couleur || null, req.params.id);
    res.json({ success: true, message: 'Matière mise à jour' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la matière' });
  }
});

// Supprimer une matière
router.delete('/matieres/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM matieres WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Matière supprimée' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de la matière' });
  }
});

// Configurer le lien emploi du temps
router.post('/settings/emploi-temps', requireAdmin, express.json(), (req, res) => {
  const { lien } = req.body;

  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('emploi_temps_lien', lien || null);
    res.json({ success: true, message: 'Lien emploi du temps configuré' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la configuration' });
  }
});

// Récupérer le lien emploi du temps
router.get('/settings/emploi-temps', requireAuth, (req, res) => {
  try {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('emploi_temps_lien');
    res.json({ lien: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

module.exports = router;
