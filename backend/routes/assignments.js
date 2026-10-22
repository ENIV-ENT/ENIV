const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const { convertToPdf } = require('../services/fileConverter');
const { checkBeforeUpload } = require('../services/fileCleanup');
const { snapshotAssignment, diffSnapshots, logAssignmentAction } = require('../services/assignmentLogger');
const push = require('../services/push');
const pushMessages = require('../services/pushMessages');
const { createFileToken } = require('../services/fileLinks');
const { findClassSubject, findClassAssignment } = require('../services/classMembership');
const { getSource } = require('../services/timetable');
const router = express.Router();

/** Assignment with its subject name, used to build the log snapshots. */
const ASSIGNMENT_WITH_SUBJECT_SQL = `
  SELECT d.*, m.nom as matiere_nom
  FROM devoirs d
  LEFT JOIN matieres m ON d.matiere_id = m.id
  WHERE d.id = ? AND d.classe_id = ?`;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

/** PDF, Word, PowerPoint and Excel files. */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];

/**
 * multer reads the file name as latin1 while browsers send it as UTF-8: it is
 * fixed here, before any use (storage, database, logs).
 */
const fileFilter = (req, file, cb) => {
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers PDF, DOCX, PPTX, XLSX sont autorisés'), false);
  }
};

/** Files up to 50 MB. */
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

router.use(requireAuth);

/** Creates an assignment; the log holds its full state as saved. */
router.post('/', express.json(), async (req, res) => {
  const { titre: title, description, matiere_id: subjectId, date } = req.body || {};

  if (!title || !subjectId) {
    return res.status(400).json({ error: 'Titre et matière requis' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    if (!await findClassSubject(subjectId, classId)) {
      return res.status(400).json({ error: 'Matière inconnue' });
    }

    const result = await db.run(
      'INSERT INTO devoirs (titre, description, matiere_id, date, classe_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description || null, subjectId, date || null, classId, req.session.userId]
    );

    const assignmentId = result.lastInsertRowid;

    const created = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [assignmentId, classId]);
    const snapshot = snapshotAssignment(created || { titre: title, description, matiere_id: subjectId, date });
    await logAssignmentAction(req, {
      assignmentId,
      action: 'create',
      details: { titre: snapshot.titre, devoir: snapshot }
    });

    push.notifyClassInBackground(classId, 'nouveau_devoir',
      pushMessages.newAssignment({ id: assignmentId, ...snapshot }), req.user.id);

    res.json({
      success: true,
      devoirId: assignmentId,
      message: 'Devoir créé avec succès'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création du devoir' });
  }
});

router.get('/', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json([]);
    }

    const assignments = await db.all(
      `SELECT
        d.*,
        m.nom as matiere_nom,
        u.username as created_by_username,
        COALESCE(ds.fait, 0) as fait,
        (SELECT COUNT(*) FROM devoir_commentaires dc WHERE dc.devoir_id = d.id) as nb_commentaires
      FROM devoirs d
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?
      WHERE d.classe_id = ?
      ORDER BY COALESCE(ds.fait, 0) ASC, d.date ASC, d.created_at DESC`,
      [req.session.userId, classId]
    );

    res.json(assignments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des devoirs' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const assignment = await db.get(
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
      [req.session.userId, req.params.id, classId]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    res.json(assignment);
  } catch {
    res.status(500).json({ error: 'Erreur lors de la récupération du devoir' });
  }
});

/**
 * Updates an assignment. It is read again after the update rather than trusting
 * the request body, so what is actually stored is compared, without false changes
 * caused by the format. Only an actual change is logged and notified.
 */
router.put('/:id', express.json(), async (req, res) => {
  const { titre: title, description, matiere_id: subjectId, date } = req.body || {};

  if (!title || !subjectId) {
    return res.status(400).json({ error: 'Titre et matière requis' });
  }

  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const oldAssignment = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [req.params.id, classId]);
    if (!oldAssignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    if (!await findClassSubject(subjectId, classId)) {
      return res.status(400).json({ error: 'Matière inconnue' });
    }

    await db.run(
      'UPDATE devoirs SET titre = ?, description = ?, matiere_id = ?, date = ? WHERE id = ? AND classe_id = ?',
      [title, description || null, subjectId, date || null, req.params.id, classId]
    );

    const newAssignment = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [req.params.id, classId]);
    const after = snapshotAssignment(newAssignment || {});
    const changes = diffSnapshots(snapshotAssignment(oldAssignment), after);

    if (changes.length > 0) {
      await logAssignmentAction(req, {
        assignmentId: req.params.id,
        action: 'update',
        details: { titre: after.titre, changes }
      });

      push.notifyAssignmentUpdatedInBackground(classId, { id: Number(req.params.id), ...after }, changes, req.user.id);
    }

    res.json({ success: true, message: 'Devoir mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du devoir' });
  }
});

/**
 * Deletes an assignment. Its attached files go with it: they are listed before the
 * deletion, and the log holds the full state of the lost assignment.
 */
router.delete('/:id', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [req.params.id, classId]);
    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const files = await db.all(
      `SELECT df.original_name, df.uploaded_at, u.username as uploaded_by_username
       FROM devoir_fichiers df
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.devoir_id = ?
       ORDER BY df.uploaded_at ASC`,
      [req.params.id]
    );

    await db.run('DELETE FROM devoirs WHERE id = ? AND classe_id = ?', [req.params.id, classId]);

    const snapshot = snapshotAssignment(assignment);
    await logAssignmentAction(req, {
      assignmentId: req.params.id,
      action: 'delete',
      details: { titre: snapshot.titre, devoir: snapshot, fichiers: files }
    });

    res.json({ success: true, message: 'Devoir supprimé' });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la suppression du devoir' });
  }
});

/** Personal done status; a student can only check the assignments of their own class. */
router.post('/:id/statut', express.json(), async (req, res) => {
  const { fait: done } = req.body || {};

  try {
    const assignment = await findClassAssignment(req.params.id, req.user.classe_id);
    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    await db.run(
      `INSERT INTO devoir_statuts (devoir_id, user_id, fait)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fait = VALUES(fait)`,
      [req.params.id, req.session.userId, done ? 1 : 0]
    );

    res.json({ success: true, message: 'Statut mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut' });
  }
});

/**
 * Timetable link of the class. ics: the timetable is shown in Eniv
 * (/emploi-du-temps) rather than opening the link in a new tab.
 */
router.get('/settings/emploi-temps', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json({ lien: null, ics: false });
    }

    const key = `emploi_temps_lien_${classId}`;
    const [setting, ics] = await Promise.all([
      db.get('SELECT value FROM settings WHERE `key` = ? AND classe_id = ?', [key, classId]),
      getSource(classId)
    ]);
    res.json({ lien: setting ? setting.value : null, ics: Boolean(ics) });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

/**
 * Uploads a file for an assignment. The uploaded file is deleted when the request
 * is refused or fails. The storage limit is checked first (cleaning up or refusing).
 */
router.post('/:id/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const classId = req.user.classe_id;
    if (!classId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await findClassAssignment(req.params.id, classId);

    if (!assignment) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const storageCheck = await checkBeforeUpload(req.file.size);

    if (!storageCheck.allowed) {
      fs.unlinkSync(req.file.path);
      return res.status(507).json({ error: storageCheck.error });
    }

    if (storageCheck.cleaned) {
      console.log(`📦 Cleanup done: ${storageCheck.cleaned.count} files deleted`);
    }

    await db.run(
      'INSERT INTO devoir_fichiers (devoir_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)',
      [req.params.id, req.file.filename, req.file.originalname, req.session.userId]
    );

    await logAssignmentAction(req, {
      assignmentId: req.params.id,
      action: 'upload_pdf',
      details: {
        titre: assignment.titre,
        fichier: {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          size: req.file.size,
          mimetype: req.file.mimetype
        }
      }
    });

    res.json({
      success: true,
      message: 'Fichier uploadé avec succès',
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error(error);
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Erreur lors de l\'upload du fichier' });
  }
});

/** Files of an assignment, with the user who uploaded each one. */
router.get('/:id/fichiers', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.json([]);
    }

    const assignment = await findClassAssignment(req.params.id, classId);

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const files = await db.all(
      `SELECT
        df.id,
        df.filename,
        df.original_name,
        df.uploaded_at,
        df.uploaded_by,
        u.username as uploaded_by_username
      FROM devoir_fichiers df
      LEFT JOIN users u ON df.uploaded_by = u.id
      WHERE df.devoir_id = ?
      ORDER BY df.uploaded_at DESC`,
      [req.params.id]
    );

    res.json(files);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des fichiers' });
  }
});

/** Temporary link to an attached file, only for members of the assignment's class. */
router.get('/fichiers/:fileId/lien', async (req, res) => {
  try {
    const file = await db.get(
      `SELECT df.id
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [req.params.fileId, req.user.classe_id]
    );

    if (!file) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    res.json({ url: `/api/fichiers/${createFileToken(file.id)}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de l\'ouverture du fichier' });
  }
});

/** Serves a file as PDF, converting it when needed (DOCX, PPTX...). */
router.get('/fichiers/:fileId/pdf', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const file = await db.get(
      `SELECT df.*, d.classe_id
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [req.params.fileId, classId]
    );

    if (!file) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    const uploadsDir = path.join(__dirname, '../uploads');
    let filePath = path.join(uploadsDir, file.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier physique non trouvé' });
    }

    try {
      filePath = await convertToPdf(filePath);
    } catch (error) {
      console.error('PDF conversion failed:', error);
      return res.status(500).json({ error: 'Erreur lors de la conversion en PDF' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.original_name}.pdf"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération du fichier' });
  }
});

/**
 * Deletes a file. Anyone can delete any file of their class, with no owner check.
 * The log keeps its size and its original uploader.
 */
router.delete('/fichiers/:fileId', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const file = await db.get(
      `SELECT df.*, d.classe_id, d.titre as devoir_titre, u.username as uploaded_by_username
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [req.params.fileId, classId]
    );

    if (!file) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    const filePath = path.join(__dirname, '../uploads', file.filename);
    let fileSize = null;
    if (fs.existsSync(filePath)) {
      fileSize = fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
    }

    await db.run('DELETE FROM devoir_fichiers WHERE id = ?', [req.params.fileId]);

    await logAssignmentAction(req, {
      assignmentId: file.devoir_id,
      action: 'delete_pdf',
      details: {
        titre: file.devoir_titre,
        fichier: {
          original_name: file.original_name,
          stored_name: file.filename,
          size: fileSize,
          uploaded_at: file.uploaded_at,
          uploaded_by_username: file.uploaded_by_username
        }
      }
    });

    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la suppression du fichier' });
  }
});

/** Quiz status of an assignment: documents, existing quiz, generation in progress. */
router.get('/:id/quiz-status', async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await db.get(
      `SELECT d.id, c.premium as classe_premium
       FROM devoirs d
       LEFT JOIN classes c ON d.classe_id = c.id
       WHERE d.id = ? AND d.classe_id = ?`,
      [req.params.id, classId]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const quizEnabled = !!req.user.premium || !!assignment.classe_premium;

    const files = await db.all(
      'SELECT id FROM devoir_fichiers WHERE devoir_id = ?',
      [req.params.id]
    );

    if (files.length === 0) {
      return res.json({
        hasDocuments: false,
        hasQuiz: false,
        isGenerating: false,
        quizEnabled
      });
    }

    const quiz = await db.get(
      'SELECT id FROM devoir_quiz WHERE devoir_id = ?',
      [req.params.id]
    );

    const generation = await db.get(
      'SELECT status FROM devoir_quiz_generation WHERE devoir_id = ?',
      [req.params.id]
    );

    res.json({
      hasDocuments: true,
      hasQuiz: !!quiz,
      isGenerating: generation && generation.status === 'pending',
      quizEnabled
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la vérification du statut' });
  }
});

/**
 * Starts the AI quiz generation of an assignment in the background. A previous
 * finished generation record is replaced; one in progress blocks a new one.
 */
router.post('/:id/generate-quiz', express.json(), async (req, res) => {
  try {
    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await db.get(
      `SELECT d.*, m.nom as matiere_nom, c.premium as classe_premium
       FROM devoirs d
       LEFT JOIN matieres m ON d.matiere_id = m.id
       LEFT JOIN classes c ON d.classe_id = c.id
       WHERE d.id = ? AND d.classe_id = ?`,
      [req.params.id, classId]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    if (!req.user.premium && !assignment.classe_premium) {
      return res.status(403).json({ error: 'La génération de quiz n\'est pas activée pour votre classe' });
    }

    const files = await db.all(
      'SELECT id FROM devoir_fichiers WHERE devoir_id = ?',
      [req.params.id]
    );

    if (files.length === 0) {
      return res.status(400).json({ error: 'Ce devoir n\'a pas de documents' });
    }

    const existingQuiz = await db.get(
      'SELECT id FROM devoir_quiz WHERE devoir_id = ?',
      [req.params.id]
    );

    if (existingQuiz) {
      return res.status(400).json({ error: 'Un quiz existe déjà pour ce devoir' });
    }

    const existingGeneration = await db.get(
      'SELECT status FROM devoir_quiz_generation WHERE devoir_id = ?',
      [req.params.id]
    );

    if (existingGeneration && existingGeneration.status === 'pending') {
      return res.status(400).json({
        error: 'Une génération est déjà en cours pour ce devoir'
      });
    }

    if (existingGeneration) {
      await db.run(
        'DELETE FROM devoir_quiz_generation WHERE devoir_id = ?',
        [req.params.id]
      );
    }

    await db.run(
      'INSERT INTO devoir_quiz_generation (devoir_id, user_id, status) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, 'pending']
    );

    generateQuizInBackground(
      req.params.id,
      assignment,
      req.user
    );

    res.json({
      success: true,
      message: 'La génération du quiz a démarré. Vous recevrez un email lorsqu\'il sera prêt.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la génération du quiz' });
  }
});

/**
 * Generates the quiz, saves it, updates the generation status and emails the user.
 * On failure, the (French) error message is stored in devoir_quiz_generation.
 */
async function generateQuizInBackground(assignmentId, assignment, user) {
  try {
    require('dotenv').config();

    const { generateQuizWithAi } = require('../services/quizGenerator');

    const files = await db.all(
      'SELECT filename, original_name FROM devoir_fichiers WHERE devoir_id = ?',
      [assignmentId]
    );

    const questions = await generateQuizWithAi(
      assignment,
      user.premium,
      files
    );

    await db.run(
      'INSERT INTO devoir_quiz (devoir_id, questions_json, mode) VALUES (?, ?, ?)',
      [assignmentId, JSON.stringify(questions), 'both']
    );

    await db.run(
      'UPDATE devoir_quiz_generation SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE devoir_id = ?',
      ['completed', assignmentId]
    );

    if (user.email) {
      const { sendQuizReadyEmail } = require('../services/email');
      await sendQuizReadyEmail(
        user.email,
        assignment.titre,
        assignmentId
      );
    }

    console.log(`Quiz generated for assignment ${assignmentId}`);
  } catch (error) {
    console.error(`Quiz generation failed for assignment ${assignmentId}:`, error);

    await db.run(
      'UPDATE devoir_quiz_generation SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE devoir_id = ?',
      ['failed', error.message, assignmentId]
    );
  }
}

module.exports = router;
