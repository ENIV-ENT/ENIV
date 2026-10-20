const express = require('express');
const crypto = require('crypto');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const { buildCalendar } = require('../services/ical');
const router = express.Router();

// Devoirs exportés : ceux à rendre à partir d'il y a 60 jours
const HISTORY_DAYS = 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function generateToken() {
  return crypto.randomBytes(32).toString('base64url'); // 43 caractères
}

function baseUrl(req) {
  return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function feedUrls(req, token) {
  const https = `${baseUrl(req)}/api/calendar/${token}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return {
    url: https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

// Lien d'abonnement de l'utilisateur connecté (null s'il n'en a pas)
router.get('/link', requireAuth, (req, res) => {
  const token = req.user.calendar_token;
  res.json(token ? feedUrls(req, token) : { url: null });
});

// Crée le lien, ou le remplace : l'ancien cesse alors immédiatement de fonctionner
router.post('/link', requireAuth, async (req, res) => {
  try {
    const token = generateToken();
    await db.run('UPDATE users SET calendar_token = ? WHERE id = ?', [token, req.user.id]);
    res.json({ success: true, ...feedUrls(req, token) });
  } catch (error) {
    console.error('Error creating calendar link:', error);
    res.status(500).json({ error: 'Erreur lors de la création du lien' });
  }
});

router.delete('/link', requireAuth, async (req, res) => {
  try {
    await db.run('UPDATE users SET calendar_token = NULL WHERE id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting calendar link:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du lien' });
  }
});

// Flux iCal, lu par les applications d'agenda sans connexion : le jeton fait office d'accès
router.get('/:token.ics', async (req, res) => {
  const { token } = req.params;
  if (!TOKEN_PATTERN.test(token)) {
    return res.status(404).type('text/plain').send('Agenda introuvable');
  }

  try {
    const user = await db.get(
      `SELECT u.id, u.classe_id, c.nom AS classe_nom
       FROM users u
       LEFT JOIN classes c ON c.id = u.classe_id
       WHERE u.calendar_token = ?`,
      [token]
    );
    if (!user) {
      return res.status(404).type('text/plain').send('Agenda introuvable');
    }

    const devoirs = user.classe_id
      ? await db.all(
        `SELECT d.id, d.titre, d.description, d.date, m.nom AS matiere_nom, COALESCE(ds.fait, 0) AS fait
         FROM devoirs d
         LEFT JOIN matieres m ON m.id = d.matiere_id
         LEFT JOIN devoir_statuts ds ON ds.devoir_id = d.id AND ds.user_id = ?
         WHERE d.classe_id = ? AND d.date IS NOT NULL
           AND d.date >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
         ORDER BY d.date, d.id`,
        [user.id, user.classe_id, HISTORY_DAYS]
      )
      : [];

    const ics = buildCalendar({
      nom: user.classe_nom ? `Eniv · ${user.classe_nom}` : 'Eniv',
      devoirs,
      baseUrl: baseUrl(req),
    });

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="eniv.ics"',
      'Cache-Control': 'private, max-age=900',
    });
    res.send(ics);
  } catch (error) {
    console.error('Error building calendar feed:', error);
    res.status(500).type('text/plain').send('Erreur serveur');
  }
});

module.exports = router;
