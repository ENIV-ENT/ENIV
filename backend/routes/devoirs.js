const express = require('express');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

router.post('/', express.json(), async (req, res) => {
  const { titre, description, matiere_id, date } = req.body;

  if (!titre || !matiere_id) {
    return res.status(400).json({ error: 'Titre et matière requis' });
  }

  try {
    const user = await db.get('SELECT classe_id, username FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !user.classe_id) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const result = await db.run(
      'INSERT INTO devoirs (titre, description, matiere_id, date, classe_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [titre, description || null, matiere_id, date || null, user.classe_id, req.session.userId]
    );

    const devoirId = result.lastInsertRowid;

    // Créer un log pour la création
    const details = JSON.stringify({ titre, description, matiere_id, date });
    await db.run(
      'INSERT INTO devoir_logs (devoir_id, action, user_id, username, classe_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [devoirId, 'create', req.session.userId, user.username, user.classe_id, details]
    );

    res.json({
      success: true,
      devoirId,
      message: 'Devoir créé avec succès'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création du devoir' });
  }
});

router.get('/', async (req, res) => {
  try {
    const user = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !user.classe_id) {
      return res.json([]);
    }

    const devoirs = await db.all(
      `SELECT
        d.*,
        m.nom as matiere_nom,
        u.username as created_by_username,
        COALESCE(ds.fait, 0) as fait
      FROM devoirs d
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?
      WHERE d.classe_id = ?
      ORDER BY COALESCE(ds.fait, 0) ASC, d.date ASC, d.created_at DESC`,
      [req.session.userId, user.classe_id]
    );

    res.json(devoirs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des devoirs' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !user.classe_id) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const devoir = await db.get(
      `SELECT
        d.*,
        m.nom as matiere_nom,
        u.username as created_by_username,
        COALESCE(ds.fait, 0) as fait
      FROM devoirs d
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?
      WHERE d.id = ? AND d.classe_id = ?`,
      [req.session.userId, req.params.id, user.classe_id]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    res.json(devoir);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération du devoir' });
  }
});

router.put('/:id', express.json(), async (req, res) => {
  const { titre, description, matiere_id, date } = req.body;

  try {
    const user = await db.get('SELECT classe_id, username FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !user.classe_id) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer l'ancien devoir pour le log
    const oldDevoir = await db.get('SELECT * FROM devoirs WHERE id = ? AND classe_id = ?', [req.params.id, user.classe_id]);
    if (!oldDevoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    await db.run(
      'UPDATE devoirs SET titre = ?, description = ?, matiere_id = ?, date = ? WHERE id = ? AND classe_id = ?',
      [titre, description || null, matiere_id, date || null, req.params.id, user.classe_id]
    );

    // Créer un log pour la modification
    const details = JSON.stringify({
      old: { titre: oldDevoir.titre, description: oldDevoir.description, matiere_id: oldDevoir.matiere_id, date: oldDevoir.date },
      new: { titre, description, matiere_id, date }
    });
    await db.run(
      'INSERT INTO devoir_logs (devoir_id, action, user_id, username, classe_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, 'update', req.session.userId, user.username, user.classe_id, details]
    );

    res.json({ success: true, message: 'Devoir mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du devoir' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const user = await db.get('SELECT classe_id, username FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !user.classe_id) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer le devoir avant de le supprimer pour le log
    const devoir = await db.get('SELECT * FROM devoirs WHERE id = ? AND classe_id = ?', [req.params.id, user.classe_id]);
    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    await db.run('DELETE FROM devoirs WHERE id = ? AND classe_id = ?', [req.params.id, user.classe_id]);

    // Créer un log pour la suppression
    const details = JSON.stringify({ titre: devoir.titre, description: devoir.description, matiere_id: devoir.matiere_id, date: devoir.date });
    await db.run(
      'INSERT INTO devoir_logs (devoir_id, action, user_id, username, classe_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, 'delete', req.session.userId, user.username, user.classe_id, details]
    );

    res.json({ success: true, message: 'Devoir supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression du devoir' });
  }
});

router.post('/:id/statut', express.json(), async (req, res) => {
  const { fait } = req.body;

  try {
    await db.run(
      `INSERT INTO devoir_statuts (devoir_id, user_id, fait)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fait = VALUES(fait)`,
      [req.params.id, req.session.userId, fait ? 1 : 0]
    );

    res.json({ success: true, message: 'Statut mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut' });
  }
});

router.get('/settings/emploi-temps', async (req, res) => {
  try {
    const user = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !user.classe_id) {
      return res.json({ lien: null });
    }

    const key = `emploi_temps_lien_${user.classe_id}`;
    const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);
    res.json({ lien: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

module.exports = router;
