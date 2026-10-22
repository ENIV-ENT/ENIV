const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../models/dbHelper');
const { getTimetable } = require('../services/timetable');
const { matchSubjects } = require('../services/timetableSubjects');
const { ProxyError } = require('../services/safeRequest');

const router = express.Router();

router.use(requireAuth);

/**
 * Emploi du temps de la classe de l'utilisateur, importé depuis son lien ICS.
 * Si la source ne répond pas, la dernière version récupérée est servie avec
 * horsLigne: true.
 */
router.get('/', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    const emploi = await getTimetable(classeId);
    if (!emploi.configure) return res.json(emploi);

    // Rattachées à chaque lecture, pas dans la version gardée : une matière
    // ajoutée ou recolorée apparaît sans attendre la prochaine récupération
    const matieres = await db.all('SELECT id, nom, couleur FROM matieres WHERE classe_id = ?', [classeId]);
    res.json({ ...emploi, evenements: matchSubjects(emploi.evenements, matieres) });
  } catch (error) {
    if (error instanceof ProxyError) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Emploi du temps:', error);
    res.status(500).json({ error: "Erreur lors de la récupération de l'emploi du temps" });
  }
});

module.exports = router;
