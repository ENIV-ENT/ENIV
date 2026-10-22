const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../models/dbHelper');
const { getTimetable } = require('../services/timetable');
const { matchSubjects } = require('../services/timetableSubjects');
const { ProxyError } = require('../services/safeRequest');

const router = express.Router();

router.use(requireAuth);

/**
 * Timetable of the user's class, imported from its ICS link.
 * If the source does not answer, the last fetched version is served with
 * horsLigne: true. Subjects are matched on each read, not in the kept version, so
 * a subject added or recolored shows up without waiting for the next fetch.
 */
router.get('/', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    const timetable = await getTimetable(classId);
    if (!timetable.configure) return res.json(timetable);

    const subjects = await db.all('SELECT id, nom, couleur FROM matieres WHERE classe_id = ?', [classId]);
    res.json({ ...timetable, evenements: matchSubjects(timetable.evenements, subjects) });
  } catch (error) {
    if (error instanceof ProxyError) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Timetable:', error);
    res.status(500).json({ error: "Erreur lors de la récupération de l'emploi du temps" });
  }
});

module.exports = router;
