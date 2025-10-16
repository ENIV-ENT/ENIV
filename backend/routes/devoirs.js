const express = require('express');
const db = require('../models/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Toutes les routes nécessitent authentification
router.use(requireAuth);

// Créer un devoir (tous les élèves peuvent créer)
router.post('/', express.json(), (req, res) => {
  const { titre, description, matiere_id, date_limite } = req.body;

  if (!titre || !matiere_id) {
    return res.status(400).json({ error: 'Titre et matière requis' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO devoirs (titre, description, matiere_id, date_limite, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(titre, description || null, matiere_id, date_limite || null, req.session.userId);

    res.json({
      success: true,
      devoirId: result.lastInsertRowid,
      message: 'Devoir créé avec succès'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création du devoir' });
  }
});

// Lister tous les devoirs avec leurs statuts
router.get('/', (req, res) => {
  try {
    const devoirs = db.prepare(`
      SELECT
        d.*,
        m.nom as matiere_nom,
        u.username as created_by_username,
        COALESCE(ds.fait, 0) as fait
      FROM devoirs d
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?
      ORDER BY COALESCE(ds.fait, 0) ASC, d.date_limite ASC, d.created_at DESC
    `).all(req.session.userId);

    res.json(devoirs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des devoirs' });
  }
});

// Récupérer un devoir spécifique
router.get('/:id', (req, res) => {
  try {
    const devoir = db.prepare(`
      SELECT
        d.*,
        m.nom as matiere_nom,
        u.username as created_by_username,
        COALESCE(ds.fait, 0) as fait
      FROM devoirs d
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?
      WHERE d.id = ?
    `).get(req.session.userId, req.params.id);

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    res.json(devoir);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération du devoir' });
  }
});

// Modifier un devoir (tous les élèves peuvent modifier)
router.put('/:id', express.json(), (req, res) => {
  const { titre, description, matiere_id, date_limite } = req.body;

  try {
    db.prepare(
      'UPDATE devoirs SET titre = ?, description = ?, matiere_id = ?, date_limite = ? WHERE id = ?'
    ).run(titre, description || null, matiere_id, date_limite || null, req.params.id);

    res.json({ success: true, message: 'Devoir mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du devoir' });
  }
});

// Supprimer un devoir (tous les élèves peuvent supprimer)
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM devoirs WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Devoir supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression du devoir' });
  }
});

// Marquer un devoir comme fait/non fait
router.post('/:id/statut', express.json(), (req, res) => {
  const { fait } = req.body;

  try {
    db.prepare(`
      INSERT INTO devoir_statuts (devoir_id, user_id, fait)
      VALUES (?, ?, ?)
      ON CONFLICT(devoir_id, user_id) DO UPDATE SET fait = excluded.fait
    `).run(req.params.id, req.session.userId, fait ? 1 : 0);

    res.json({ success: true, message: 'Statut mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut' });
  }
});

// Récupérer le lien emploi du temps
router.get('/settings/emploi-temps', (req, res) => {
  try {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('emploi_temps_lien');
    res.json({ lien: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

module.exports = router;
