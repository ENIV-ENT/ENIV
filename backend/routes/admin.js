const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendJoinRequestAcceptedEmail } = require('../services/email');
const { getTimetable, getSource, setSource } = require('../services/timetable');
const { prepareUrl } = require('../services/safeRequest');
const router = express.Router();

const ICS_URL_MAX_LENGTH = 2048;

router.post('/eleves', requireAdmin, express.json(), async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username et password requis' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password, role, classe_id) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, 'eleve', classId]
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

router.get('/eleves', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const students = await db.all(
      'SELECT id, username, created_at, email, nom, prenom, role, last_login_at FROM users WHERE classe_id = ?',
      [classId]
    );
    res.json(students);
  } catch {
    res.status(500).json({ error: 'Erreur lors de la récupération des élèves' });
  }
});

/** Updates a student (username, info and optionally the password). */
router.put('/eleves/:id', requireAdmin, express.json(), async (req, res) => {
  const { username, email, nom: lastName, prenom: firstName, password } = req.body || {};

  if (!username) {
    return res.status(400).json({ error: 'Nom d\'utilisateur requis' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(
        'UPDATE users SET username = ?, email = ?, nom = ?, prenom = ?, password = ? WHERE id = ? AND role = ? AND classe_id = ?',
        [username, email, lastName, firstName, hashedPassword, req.params.id, 'eleve', classId]
      );
    } else {
      await db.run(
        'UPDATE users SET username = ?, email = ?, nom = ?, prenom = ? WHERE id = ? AND role = ? AND classe_id = ?',
        [username, email, lastName, firstName, req.params.id, 'eleve', classId]
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

/**
 * Grants or removes the admin status of a class member. The class must keep at
 * least one admin.
 *
 * The class admins are locked first: every concurrent request takes this lock
 * first, which serializes them (otherwise two crossed demotions deadlock) and
 * freezes the count.
 */
router.put('/eleves/:id/admin', requireAdmin, express.json(), async (req, res) => {
  const { admin } = req.body || {};

  if (typeof admin !== 'boolean') {
    return res.status(400).json({ error: 'Le champ admin doit être un booléen' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const newRole = admin ? 'admin' : 'eleve';

    await db.transaction(async (connection) => {
      const [admins] = await connection.query(
        'SELECT id FROM users WHERE classe_id = ? AND role = ? FOR UPDATE',
        [classId, 'admin']
      );

      const [targets] = await connection.query(
        'SELECT id, role FROM users WHERE id = ? AND classe_id = ? AND role IN (?, ?) FOR UPDATE',
        [req.params.id, classId, 'eleve', 'admin']
      );
      const target = targets[0];

      if (!target) {
        throw Object.assign(new Error('Élève introuvable dans cette classe'), { status: 404 });
      }

      if (target.role === newRole) {
        return;
      }

      if (!admin && admins.length <= 1) {
        throw Object.assign(
          new Error('La classe doit conserver au moins un administrateur'),
          { status: 400 }
        );
      }

      await connection.query('UPDATE users SET role = ? WHERE id = ?', [newRole, target.id]);
    });

    res.json({
      success: true,
      message: admin ? 'Statut administrateur accordé' : 'Statut administrateur retiré'
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
      return res.status(409).json({ error: 'Modification concurrente détectée, veuillez réessayer' });
    }
    console.error('Error updating admin status:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du statut administrateur' });
  }
});

router.delete('/eleves/:id', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run(
      'DELETE FROM users WHERE id = ? AND role = ? AND classe_id = ?',
      [req.params.id, 'eleve', classId]
    );
    res.json({ success: true, message: 'Élève supprimé' });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'élève' });
  }
});

/** Class of the logged-in admin. */
router.get('/classe', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const schoolClass = await db.get('SELECT id, nom FROM classes WHERE id = ?', [classId]);
    if (!schoolClass) {
      return res.status(404).json({ error: 'Classe introuvable' });
    }

    res.json(schoolClass);
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la classe' });
  }
});

/** Renames the class of the logged-in admin. */
router.put('/classe', requireAdmin, express.json(), async (req, res) => {
  const { nom: name } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nom de classe requis' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run('UPDATE classes SET nom = ? WHERE id = ?', [name.trim(), classId]);

    res.json({ success: true, message: 'Classe renommée avec succès' });
  } catch (error) {
    console.error('Error renaming class:', error);
    res.status(500).json({ error: 'Erreur lors du renommage de la classe' });
  }
});

router.post('/matieres', requireAdmin, express.json(), async (req, res) => {
  const { nom: name, lien: link, couleur: color } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'Nom de matière requis' });
  }

  if (!color || color.trim() === '') {
    return res.status(400).json({ error: 'Couleur de matière requise' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const result = await db.run(
      'INSERT INTO matieres (nom, lien, couleur, classe_id) VALUES (?, ?, ?, ?)',
      [name, link || null, color, classId]
    );

    res.json({
      success: true,
      matiereId: result.lastInsertRowid,
      message: 'Matière créée avec succès'
    });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la matière' });
  }
});

/** Lists the subjects of the class (any authenticated user). */
router.get('/matieres', requireAuth, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json([]);
    }

    const subjects = await db.all(
      'SELECT * FROM matieres WHERE classe_id = ? ORDER BY nom',
      [classId]
    );
    res.json(subjects);
  } catch {
    res.status(500).json({ error: 'Erreur lors de la récupération des matières' });
  }
});

router.put('/matieres/:id', requireAdmin, express.json(), async (req, res) => {
  const { nom: name, lien: link, couleur: color } = req.body || {};

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run(
      'UPDATE matieres SET nom = ?, lien = ?, couleur = ? WHERE id = ? AND classe_id = ?',
      [name, link || null, color || null, req.params.id, classId]
    );
    res.json({ success: true, message: 'Matière mise à jour' });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la matière' });
  }
});

router.delete('/matieres/:id', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    await db.run(
      'DELETE FROM matieres WHERE id = ? AND classe_id = ?',
      [req.params.id, classId]
    );
    res.json({ success: true, message: 'Matière supprimée' });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la suppression de la matière' });
  }
});

/** Sets the timetable link of the class (external page). */
router.post('/settings/emploi-temps', requireAdmin, express.json(), async (req, res) => {
  const { lien: link } = req.body || {};

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const key = `emploi_temps_lien_${classId}`;
    await db.run(
      'INSERT INTO settings (`key`, value, classe_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), classe_id = VALUES(classe_id)',
      [key, link || null, classId]
    );
    res.json({ success: true, message: 'Lien emploi du temps configuré' });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la configuration' });
  }
});

router.get('/settings/emploi-temps', requireAuth, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json({ lien: null });
    }

    const key = `emploi_temps_lien_${classId}`;
    const setting = await db.get(
      'SELECT value FROM settings WHERE `key` = ? AND classe_id = ?',
      [key, classId]
    );
    res.json({ lien: setting ? setting.value : null });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

/**
 * Sets the ICS link: the timetable is then shown in Eniv. Without a JSON body,
 * req.body is undefined in Express 5.
 *
 * A first fetch runs at once, so the admin knows whether the link works. A source
 * that cannot be reached at the moment does not prevent saving the link.
 */
router.post('/settings/emploi-temps-ics', requireAdmin, express.json(), async (req, res) => {
  const { lien: input } = req.body || {};
  const link = typeof input === 'string' ? input.trim() : '';

  const classId = req.user.classe_id;
  if (!classId) {
    return res.status(400).json({ error: 'Admin non associé à une classe' });
  }

  if (link) {
    if (link.length > ICS_URL_MAX_LENGTH) {
      return res.status(400).json({ error: 'Lien ICS trop long' });
    }

    try {
      prepareUrl(link);
    } catch (error) {
      return res.status(400).json({ error: `Lien ICS invalide : ${error.message}` });
    }
  }

  try {
    await setSource(classId, link || null);

    if (!link) {
      return res.json({ success: true, message: 'Lien ICS supprimé' });
    }

    let failure;
    try {
      const timetable = await getTimetable(classId, { force: true });
      if (!timetable.horsLigne) {
        return res.json({ success: true, nombreCours: timetable.evenements.length });
      }
      failure = timetable.erreur;
    } catch (error) {
      failure = error.message;
    }
    res.json({ success: true, avertissement: `Lien enregistré, mais l'emploi du temps n'a pas pu être récupéré : ${failure}` });
  } catch (error) {
    console.error('Error configuring ICS link:', error);
    res.status(500).json({ error: 'Erreur lors de la configuration' });
  }
});

router.get('/settings/emploi-temps-ics', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    res.json({ lien: classId ? await getSource(classId) : null });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

/** Sets the Discord webhook (discord.com and discordapp.com are accepted). */
router.post('/settings/discord-webhook', requireAdmin, express.json(), async (req, res) => {
  const { webhook } = req.body || {};

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    if (webhook && !webhook.match(/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/.+/)) {
      return res.status(400).json({ error: 'URL de webhook Discord invalide' });
    }

    const key = `discord_webhook_${classId}`;
    await db.run(
      'INSERT INTO settings (`key`, value, classe_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), classe_id = VALUES(classe_id)',
      [key, webhook || null, classId]
    );
    res.json({ success: true, message: 'Webhook Discord configuré' });
  } catch (error) {
    console.error('Error configuring Discord webhook:', error);
    res.status(500).json({ error: 'Erreur lors de la configuration du webhook' });
  }
});

router.get('/settings/discord-webhook', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json({ webhook: null });
    }

    const key = `discord_webhook_${classId}`;
    const setting = await db.get(
      'SELECT value FROM settings WHERE `key` = ? AND classe_id = ?',
      [key, classId]
    );
    res.json({ webhook: setting ? setting.value : null });
  } catch (error) {
    console.error('Error retrieving Discord webhook:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du webhook' });
  }
});

/** Assignment history of the class (admin only), 100 latest entries. */
router.get('/logs/devoirs', requireAdmin, async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json([]);
    }

    const logs = await db.all(
      `SELECT
        l.*,
        m.nom as matiere_nom,
        d.titre as devoir_titre,
        d.id IS NOT NULL as devoir_existe,
        u.nom as user_nom,
        u.prenom as user_prenom,
        u.role as user_role
      FROM devoir_logs l
      LEFT JOIN devoirs d ON l.devoir_id = d.id
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.classe_id = ?
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 100`,
      [classId]
    );

    res.json(logs);
  } catch (error) {
    console.error('Error retrieving logs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
  }
});

/** Pending join requests of the class. */
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

/** Accepts or rejects a join request; an accepted student is told by email. */
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

      const [student, schoolClass] = await Promise.all([
        db.get('SELECT email, nom, prenom FROM users WHERE id = ?', [request.user_id]),
        db.get('SELECT nom FROM classes WHERE id = ?', [admin.classe_id])
      ]);

      if (student && student.email && schoolClass && schoolClass.nom) {
        const studentName = `${student.prenom || ''} ${student.nom || ''}`.trim() || 'élève';
        await sendJoinRequestAcceptedEmail(student.email, studentName, schoolClass.nom);
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

router.post('/join-requests/:id/accept', requireAdmin, (req, res) => handleJoinRequest(req, res, 'accepted'));

router.post('/join-requests/:id/reject', requireAdmin, (req, res) => handleJoinRequest(req, res, 'rejected'));

/** Prefilled signup link of the class, null if the class has no school. */
router.get('/invite-link', requireAdmin, async (req, res) => {
  try {
    const admin = await db.get('SELECT classe_id FROM users WHERE id = ?', [req.session.userId]);
    if (!admin || !admin.classe_id) {
      return res.status(400).json({ error: 'Admin non associé à une classe' });
    }

    const schoolClass = await db.get('SELECT id, etablissement_id FROM classes WHERE id = ?', [admin.classe_id]);
    if (!schoolClass || !schoolClass.etablissement_id) {
      return res.json({ link: null, message: 'Aucun établissement associé à cette classe' });
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link = `${baseUrl}/register?classe_id=${schoolClass.id}&etab_id=${schoolClass.etablissement_id}`;

    res.json({ link });
  } catch (error) {
    console.error('Error generating invite link:', error);
    res.status(500).json({ error: 'Erreur lors de la génération du lien' });
  }
});

module.exports = router;
