const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendJoinRequestAcceptedEmail } = require('../services/email');
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
async function getUniqueColor() {
  try {
    const usedColors = await db.all('SELECT couleur FROM matieres WHERE couleur IS NOT NULL', []);
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

// Créer un élève
router.post('/eleves', requireAdmin, express.json(), async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username et password requis' });
  }

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password, role, classe_id) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, 'eleve', classeId]
    );

    res.json({
      success: true,
      eleveId: result.lastInsertRowid,
      message: 'Élève créé avec succès'
    });
  } catch (error) {
    if (error.message.includes('UNIQUE') || error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de la création de l\'élève' });
    }
  }
});

// Lister tous les élèves
router.get('/eleves', requireAdmin, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const eleves = await db.all(
      'SELECT id, username, created_at, email, nom, prenom FROM users WHERE classe_id = ?',
      [classeId]
    );
    res.json(eleves);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des élèves' });
  }
});

// Modifier un élève (username et/ou mot de passe)
router.put('/eleves/:id', requireAdmin, express.json(), async (req, res) => {
  const { username, email, nom, prenom, password } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Nom d\'utilisateur requis' });
  }

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    if (password) {
      const hashedPassword = bcrypt.hashSync(password, 10);
      await db.run(
        'UPDATE users SET username = ?, email = ?, nom = ?, prenom = ?, password = ? WHERE id = ? AND role = ? AND classe_id = ?',
        [username, email, nom, prenom, hashedPassword, req.params.id, 'eleve', classeId]
      );
    } else {
      await db.run(
        'UPDATE users SET username = ?, email = ?, nom = ?, prenom = ? WHERE id = ? AND role = ? AND classe_id = ?',
        [username, email, nom, prenom, req.params.id, 'eleve', classeId]
      );
    }
    res.json({ success: true, message: 'Élève modifié avec succès' });
  } catch (error) {
    if (error.message.includes('UNIQUE') || error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de la modification de l\'élève' });
    }
  }
});

// Supprimer un élève
router.delete('/eleves/:id', requireAdmin, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run(
      'DELETE FROM users WHERE id = ? AND role = ? AND classe_id = ?',
      [req.params.id, 'eleve', classeId]
    );
    res.json({ success: true, message: 'Élève supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'élève' });
  }
});

// Créer une matière
router.post('/matieres', requireAdmin, express.json(), async (req, res) => {
  const { nom, lien, couleur } = req.body;

  if (!nom) {
    return res.status(400).json({ error: 'Nom de matière requis' });
  }

  if (!couleur || couleur.trim() === '') {
    return res.status(400).json({ error: 'Couleur de matière requise' });
  }

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const result = await db.run(
      'INSERT INTO matieres (nom, lien, couleur, classe_id) VALUES (?, ?, ?, ?)',
      [nom, lien || null, couleur, classeId]
    );

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
router.get('/matieres', requireAuth, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.json([]);
    }

    const matieres = await db.all(
      'SELECT * FROM matieres WHERE classe_id = ? ORDER BY nom',
      [classeId]
    );
    res.json(matieres);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des matières' });
  }
});

// Modifier une matière
router.put('/matieres/:id', requireAdmin, express.json(), async (req, res) => {
  const { nom, lien, couleur } = req.body;

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run(
      'UPDATE matieres SET nom = ?, lien = ?, couleur = ? WHERE id = ? AND classe_id = ?',
      [nom, lien || null, couleur || null, req.params.id, classeId]
    );
    res.json({ success: true, message: 'Matière mise à jour' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la matière' });
  }
});

// Supprimer une matière
router.delete('/matieres/:id', requireAdmin, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run(
      'DELETE FROM matieres WHERE id = ? AND classe_id = ?',
      [req.params.id, classeId]
    );
    res.json({ success: true, message: 'Matière supprimée' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de la matière' });
  }
});

// Configurer le lien emploi du temps
router.post('/settings/emploi-temps', requireAdmin, express.json(), async (req, res) => {
  const { lien } = req.body;

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const key = `emploi_temps_lien_${classeId}`;
    await db.run(
      'INSERT INTO settings (`key`, value, classe_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), classe_id = VALUES(classe_id)',
      [key, lien || null, classeId]
    );
    res.json({ success: true, message: 'Lien emploi du temps configuré' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la configuration' });
  }
});

// Récupérer le lien emploi du temps
router.get('/settings/emploi-temps', requireAuth, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.json({ lien: null });
    }

    const key = `emploi_temps_lien_${classeId}`;
    const setting = await db.get(
      'SELECT value FROM settings WHERE `key` = ? AND classe_id = ?',
      [key, classeId]
    );
    res.json({ lien: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Configurer le webhook Discord
router.post('/settings/discord-webhook', requireAdmin, express.json(), async (req, res) => {
  const { webhook } = req.body;

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    // Valider le format du webhook Discord (accepte discord.com et discordapp.com)
    if (webhook && !webhook.match(/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/.+/)) {
      return res.status(400).json({ error: 'URL de webhook Discord invalide' });
    }

    const key = `discord_webhook_${classeId}`;
    await db.run(
      'INSERT INTO settings (`key`, value, classe_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), classe_id = VALUES(classe_id)',
      [key, webhook || null, classeId]
    );
    res.json({ success: true, message: 'Webhook Discord configuré' });
  } catch (error) {
    console.error('Error configuring Discord webhook:', error);
    res.status(500).json({ error: 'Erreur lors de la configuration du webhook' });
  }
});

// Récupérer le webhook Discord
router.get('/settings/discord-webhook', requireAdmin, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.json({ webhook: null });
    }

    const key = `discord_webhook_${classeId}`;
    const setting = await db.get(
      'SELECT value FROM settings WHERE `key` = ? AND classe_id = ?',
      [key, classeId]
    );
    res.json({ webhook: setting ? setting.value : null });
  } catch (error) {
    console.error('Error retrieving Discord webhook:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du webhook' });
  }
});

// Récupérer les logs de devoirs (admin uniquement)
router.get('/logs/devoirs', requireAdmin, async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.json([]);
    }

    const logs = await db.all(
      `SELECT
        l.*,
        m.nom as matiere_nom
      FROM devoir_logs l
      LEFT JOIN devoirs d ON l.devoir_id = d.id
      LEFT JOIN matieres m ON d.matiere_id = m.id
      WHERE l.classe_id = ?
      ORDER BY l.created_at DESC
      LIMIT 100`,
      [classeId]
    );

    res.json(logs);
  } catch (error) {
    console.error('Error retrieving logs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
  }
});

// Lister les demandes d'adhésion en attente
router.get('/join-requests', requireAdmin, async (req, res) => {
  try {
    const admin = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!admin || !admin.classe_id) {
      return res.json([]);
    }

    const requests = await db.all(
      `SELECT jr.id, jr.status, jr.created_at,
        u.id as user_id, u.username, u.nom, u.prenom, u.email
       FROM join_requests jr
       JOIN users u ON jr.user_id = u.id
       WHERE jr.classe_id = ? AND jr.status = 'pending'
       ORDER BY jr.created_at DESC`,
      [admin.classe_id]
    );
    res.json(requests);
  } catch (error) {
    console.error('Error fetching join requests:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des demandes' });
  }
});

// Traiter une demande d'adhésion (accepter ou rejeter)
async function handleJoinRequest(req, res, newStatus) {
  try {
    const admin = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const request = await db.get(
      'SELECT * FROM join_requests WHERE id = ? AND classe_id = ? AND status = ?',
      [req.params.id, admin.classe_id, 'pending']
    );

    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    await db.run('UPDATE join_requests SET status = ? WHERE id = ?', [newStatus, req.params.id]);

    if (newStatus === 'accepted') {
      await db.run('UPDATE users SET classe_id = ? WHERE id = ?', [admin.classe_id, request.user_id]);

      const [student, classe] = await Promise.all([
        db.get('SELECT email, nom, prenom FROM users WHERE id = ?', [request.user_id]),
        db.get('SELECT nom FROM classes WHERE id = ?', [admin.classe_id])
      ]);

      if (student && student.email && classe && classe.nom) {
        const studentName = `${student.prenom || ''} ${student.nom || ''}`.trim() || 'élève';
        await sendJoinRequestAcceptedEmail(student.email, studentName, classe.nom);
      }
    }

    const label = newStatus === 'accepted' ? 'acceptée' : 'rejetée';
    res.json({ success: true, message: `Demande ${label}` });
  } catch (error) {
    console.error(`Error ${newStatus === 'accepted' ? 'accepting' : 'rejecting'} join request:`, error);
    const label = newStatus === 'accepted' ? "l'acceptation" : 'du rejet';
    res.status(500).json({ error: `Erreur lors de ${label}` });
  }
}

// Accepter une demande d'adhésion
router.post('/join-requests/:id/accept', requireAdmin, (req, res) => handleJoinRequest(req, res, 'accepted'));

// Rejeter une demande d'adhésion
router.post('/join-requests/:id/reject', requireAdmin, (req, res) => handleJoinRequest(req, res, 'rejected'));

// Générer/récupérer le lien d'invitation pré-rempli
router.get('/invite-link', requireAdmin, async (req, res) => {
  try {
    const admin = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const classe = await db.get('SELECT id, etablissement_id FROM classes WHERE id = ?', [admin.classe_id]);
    if (!classe || !classe.etablissement_id) {
      return res.json({ link: null, message: 'Aucun établissement associé à cette classe' });
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link = `${baseUrl}/register?classe_id=${classe.id}&etab_id=${classe.etablissement_id}`;

    res.json({ link });
  } catch (error) {
    console.error('Error generating invite link:', error);
    res.status(500).json({ error: 'Erreur lors de la génération du lien' });
  }
});

module.exports = router;
