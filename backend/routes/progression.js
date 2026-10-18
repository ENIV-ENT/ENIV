const express = require('express');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const { calculerProgression } = require('../services/progression');
const router = express.Router();

// Assez d'historique pour la série de devoirs faits d'affilée
const JOURS_LUS = 120;

function aujourdhuiParis(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

// Progression personnelle de l'élève connecté
router.get('/', requireAuth, async (req, res) => {
  if (!req.user.classe_id) {
    return res.status(404).json({ error: 'Aucune classe associée' });
  }

  try {
    const devoirs = await db.all(
      `SELECT d.id, d.titre, d.date, COALESCE(ds.fait, 0) AS fait,
              m.nom AS matiere_nom, m.couleur AS matiere_couleur
       FROM devoirs d
       LEFT JOIN matieres m ON m.id = d.matiere_id
       LEFT JOIN devoir_statuts ds ON ds.devoir_id = d.id AND ds.user_id = ?
       WHERE d.classe_id = ? AND d.date IS NOT NULL
         AND d.date >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)`,
      [req.user.id, req.user.classe_id, JOURS_LUS]
    );

    res.json(calculerProgression(devoirs, aujourdhuiParis()));
  } catch (error) {
    console.error('Error computing progression:', error);
    res.status(500).json({ error: 'Erreur lors du calcul de la progression' });
  }
});

module.exports = router;
