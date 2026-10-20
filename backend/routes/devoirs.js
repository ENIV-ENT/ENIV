const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const { convertToPDF } = require('../services/fileConverter');
const { check_before_upload } = require('../services/fileCleanup');
const { snapshotDevoir, diffSnapshots, logDevoirAction } = require('../services/devoirLogger');
const push = require('../services/push');
const pushMessages = require('../services/pushMessages');
const { creerJeton } = require('../services/fichierLinks');
const router = express.Router();

// Devoir avec le nom de sa matière, utilisé pour construire les instantanés des logs
const DEVOIR_WITH_MATIERE_SQL = `
  SELECT d.*, m.nom as matiere_nom
  FROM devoirs d
  LEFT JOIN matieres m ON d.matiere_id = m.id
  WHERE d.id = ? AND d.classe_id = ?`;

// La matière doit appartenir à la classe du devoir
async function matiereDeLaClasse(matiereId, classeId) {
  return db.get('SELECT id FROM matieres WHERE id = ? AND classe_id = ?', [matiereId, classeId]);
}

// Configuration de multer pour l'upload de fichiers PDF
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

const fileFilter = (req, file, cb) => {
  // multer lit le nom en latin1 alors que les navigateurs l'envoient en UTF-8 :
  // on le corrige ici, avant tout usage (stockage, base, journaux)
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

  // Accepter PDF, DOCX, PPTX
  const allowedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel' // .xls
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers PDF, DOCX, PPTX, XLSX sont autorisés'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // Limite de 50 Mo
  }
});

router.use(requireAuth);

router.post('/', express.json(), async (req, res) => {
  const { titre, description, matiere_id, date } = req.body;

  if (!titre || !matiere_id) {
    return res.status(400).json({ error: 'Titre et matière requis' });
  }

  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    if (!await matiereDeLaClasse(matiere_id, classeId)) {
      return res.status(400).json({ error: 'Matière inconnue' });
    }

    const result = await db.run(
      'INSERT INTO devoirs (titre, description, matiere_id, date, classe_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [titre, description || null, matiere_id, date || null, classeId, req.session.userId]
    );

    const devoirId = result.lastInsertRowid;

    // Journaliser la création avec l'état complet du devoir tel qu'enregistré
    const created = await db.get(DEVOIR_WITH_MATIERE_SQL, [devoirId, classeId]);
    const snapshot = snapshotDevoir(created || { titre, description, matiere_id, date });
    await logDevoirAction(req, {
      devoirId,
      action: 'create',
      details: { titre: snapshot.titre, devoir: snapshot }
    });

    push.notifyClasseInBackground(classeId, 'nouveau_devoir',
      pushMessages.nouveauDevoir({ id: devoirId, ...snapshot }), req.user.id);

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
    const classeId = req.user.classe_id;
    if (!classeId) {
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
      [req.session.userId, classeId]
    );

    res.json(devoirs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des devoirs' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
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
      [req.session.userId, req.params.id, classeId]
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
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer l'état avant modification pour le log
    const oldDevoir = await db.get(DEVOIR_WITH_MATIERE_SQL, [req.params.id, classeId]);
    if (!oldDevoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    if (!await matiereDeLaClasse(matiere_id, classeId)) {
      return res.status(400).json({ error: 'Matière inconnue' });
    }

    await db.run(
      'UPDATE devoirs SET titre = ?, description = ?, matiere_id = ?, date = ? WHERE id = ? AND classe_id = ?',
      [titre, description || null, matiere_id, date || null, req.params.id, classeId]
    );

    // Relire le devoir plutôt que de se fier au corps de la requête : on compare
    // ainsi ce qui est réellement stocké, sans fausse modification due au format
    const newDevoir = await db.get(DEVOIR_WITH_MATIERE_SQL, [req.params.id, classeId]);
    const after = snapshotDevoir(newDevoir || {});
    const changes = diffSnapshots(snapshotDevoir(oldDevoir), after);

    // Journaliser uniquement si quelque chose a effectivement changé
    if (changes.length > 0) {
      await logDevoirAction(req, {
        devoirId: req.params.id,
        action: 'update',
        details: { titre: after.titre, changes }
      });

      push.notifyDevoirModifieInBackground(classeId, { id: Number(req.params.id), ...after }, changes, req.user.id);
    }

    res.json({ success: true, message: 'Devoir mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du devoir' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer le devoir avant de le supprimer pour le log
    const devoir = await db.get(DEVOIR_WITH_MATIERE_SQL, [req.params.id, classeId]);
    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    // Les documents joints partent avec le devoir : les lister avant la suppression
    const fichiers = await db.all(
      `SELECT df.original_name, df.uploaded_at, u.username as uploaded_by_username
       FROM devoir_fichiers df
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.devoir_id = ?
       ORDER BY df.uploaded_at ASC`,
      [req.params.id]
    );

    await db.run('DELETE FROM devoirs WHERE id = ? AND classe_id = ?', [req.params.id, classeId]);

    // Journaliser la suppression avec l'état complet du devoir perdu
    const snapshot = snapshotDevoir(devoir);
    await logDevoirAction(req, {
      devoirId: req.params.id,
      action: 'delete',
      details: { titre: snapshot.titre, devoir: snapshot, fichiers }
    });

    res.json({ success: true, message: 'Devoir supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression du devoir' });
  }
});

router.post('/:id/statut', express.json(), async (req, res) => {
  const { fait } = req.body;

  try {
    // Un élève ne peut cocher que les devoirs de sa propre classe
    const devoir = await db.get(
      'SELECT id FROM devoirs WHERE id = ? AND classe_id = ?',
      [req.params.id, req.user.classe_id]
    );
    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

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
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.json({ lien: null });
    }

    const key = `emploi_temps_lien_${classeId}`;
    const setting = await db.get('SELECT value FROM settings WHERE `key` = ? AND classe_id = ?', [key, classeId]);
    res.json({ lien: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Upload d'un PDF pour un devoir
router.post('/:id/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const classeId = req.user.classe_id;
    if (!classeId) {
      // Supprimer le fichier uploadé
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Vérifier que le devoir existe et appartient à la même classe
    const devoir = await db.get(
      'SELECT id, titre FROM devoirs WHERE id = ? AND classe_id = ?',
      [req.params.id, classeId]
    );

    if (!devoir) {
      // Supprimer le fichier uploadé
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    // Vérifier la limite de stockage (nettoie si nécessaire ou refuse)
    const storageCheck = await check_before_upload(req.file.size);
    
    if (!storageCheck.allowed) {
      // Supprimer le fichier uploadé
      fs.unlinkSync(req.file.path);
      return res.status(507).json({ error: storageCheck.error });
    }
    
    if (storageCheck.cleaned) {
      console.log(`📦 Nettoyage effectué: ${storageCheck.cleaned.count} fichiers supprimés`);
    }

    // Enregistrer le fichier dans la base de données avec l'utilisateur qui l'a uploadé
    await db.run(
      'INSERT INTO devoir_fichiers (devoir_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)',
      [req.params.id, req.file.filename, req.file.originalname, req.session.userId]
    );

    // Journaliser l'ajout du document avec ses caractéristiques
    await logDevoirAction(req, {
      devoirId: req.params.id,
      action: 'upload_pdf',
      details: {
        titre: devoir.titre,
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
    // Supprimer le fichier en cas d'erreur
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Erreur lors de l\'upload du fichier' });
  }
});

// Récupérer les fichiers d'un devoir
router.get('/:id/fichiers', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.json([]);
    }

    // Vérifier que le devoir existe et appartient à la même classe
    const devoir = await db.get(
      'SELECT id FROM devoirs WHERE id = ? AND classe_id = ?',
      [req.params.id, classeId]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    // Récupérer les fichiers avec les informations de l'utilisateur qui les a uploadés
    const fichiers = await db.all(
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

    res.json(fichiers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des fichiers' });
  }
});

// Lien temporaire vers un document joint, réservé aux membres de la classe du devoir
router.get('/fichiers/:fichierId/lien', async (req, res) => {
  try {
    const fichier = await db.get(
      `SELECT df.id
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [req.params.fichierId, req.user.classe_id]
    );

    if (!fichier) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    res.json({ url: `/api/fichiers/${creerJeton(fichier.id)}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de l\'ouverture du fichier' });
  }
});

// Servir un fichier en PDF (avec conversion automatique si nécessaire)
router.get('/fichiers/:fichierId/pdf', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Récupérer le fichier avec vérification de la classe
    const fichier = await db.get(
      `SELECT df.*, d.classe_id
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [req.params.fichierId, classeId]
    );

    if (!fichier) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    const uploadsDir = path.join(__dirname, '../uploads');
    let filePath = path.join(uploadsDir, fichier.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier physique non trouvé' });
    }

    // Convertir en PDF si nécessaire (DOCX, PPTX, etc.)
    try {
      filePath = await convertToPDF(filePath);
    } catch (error) {
      console.error('Erreur conversion PDF:', error);
      return res.status(500).json({ error: 'Erreur lors de la conversion en PDF' });
    }

    // Envoyer le fichier PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fichier.original_name}.pdf"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération du fichier' });
  }
});

// Supprimer un fichier
router.delete('/fichiers/:fichierId', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer le fichier avec vérification de la classe
    const fichier = await db.get(
      `SELECT df.*, d.classe_id, d.titre as devoir_titre, u.username as uploaded_by_username
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [req.params.fichierId, classeId]
    );

    if (!fichier) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    // Tout le monde peut supprimer tous les fichiers de sa classe
    // Pas de vérification de propriétaire nécessaire

    // Supprimer le fichier du système de fichiers, en relevant sa taille pour le log
    const filePath = path.join(__dirname, '../uploads', fichier.filename);
    let fileSize = null;
    if (fs.existsSync(filePath)) {
      fileSize = fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
    }

    // Supprimer l'enregistrement de la base de données
    await db.run('DELETE FROM devoir_fichiers WHERE id = ?', [req.params.fichierId]);

    // Journaliser la suppression du document, y compris son auteur d'origine
    await logDevoirAction(req, {
      devoirId: fichier.devoir_id,
      action: 'delete_pdf',
      details: {
        titre: fichier.devoir_titre,
        fichier: {
          original_name: fichier.original_name,
          stored_name: fichier.filename,
          size: fileSize,
          uploaded_at: fichier.uploaded_at,
          uploaded_by_username: fichier.uploaded_by_username
        }
      }
    });

    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la suppression du fichier' });
  }
});

// Vérifier le statut d'un quiz pour un devoir
router.get('/:id/quiz-status', async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const devoir = await db.get(
      `SELECT d.id, c.premium as classe_premium
       FROM devoirs d
       LEFT JOIN classes c ON d.classe_id = c.id
       WHERE d.id = ? AND d.classe_id = ?`,
      [req.params.id, classeId]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const quizEnabled = !!req.user.premium || !!devoir.classe_premium;

    // Vérifier s'il y a des fichiers
    const fichiers = await db.all(
      'SELECT id FROM devoir_fichiers WHERE devoir_id = ?',
      [req.params.id]
    );

    if (fichiers.length === 0) {
      return res.json({
        hasDocuments: false,
        hasQuiz: false,
        isGenerating: false,
        quizEnabled
      });
    }

    // Vérifier si un quiz existe
    const quiz = await db.get(
      'SELECT id FROM devoir_quiz WHERE devoir_id = ?',
      [req.params.id]
    );

    // Vérifier si une génération est en cours
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

// Générer un quiz avec l'IA
router.post('/:id/generate-quiz', express.json(), async (req, res) => {
  try {
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(400).json({ error: 'Utilisateur non associé à une classe' });
    }

    const devoir = await db.get(
      `SELECT d.*, m.nom as matiere_nom, c.premium as classe_premium
       FROM devoirs d
       LEFT JOIN matieres m ON d.matiere_id = m.id
       LEFT JOIN classes c ON d.classe_id = c.id
       WHERE d.id = ? AND d.classe_id = ?`,
      [req.params.id, classeId]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    if (!req.user.premium && !devoir.classe_premium) {
      return res.status(403).json({ error: 'La génération de quiz n\'est pas activée pour votre classe' });
    }

    // Vérifier s'il y a des documents
    const fichiers = await db.all(
      'SELECT id FROM devoir_fichiers WHERE devoir_id = ?',
      [req.params.id]
    );

    if (fichiers.length === 0) {
      return res.status(400).json({ error: 'Ce devoir n\'a pas de documents' });
    }

    // Vérifier si un quiz existe déjà
    const existingQuiz = await db.get(
      'SELECT id FROM devoir_quiz WHERE devoir_id = ?',
      [req.params.id]
    );

    if (existingQuiz) {
      return res.status(400).json({ error: 'Un quiz existe déjà pour ce devoir' });
    }

    // Vérifier si une génération est en cours
    const existingGeneration = await db.get(
      'SELECT status FROM devoir_quiz_generation WHERE devoir_id = ?',
      [req.params.id]
    );

    if (existingGeneration && existingGeneration.status === 'pending') {
      return res.status(400).json({ 
        error: 'Une génération est déjà en cours pour ce devoir' 
      });
    }

    // Supprimer l'ancienne génération si elle existe
    if (existingGeneration) {
      await db.run(
        'DELETE FROM devoir_quiz_generation WHERE devoir_id = ?',
        [req.params.id]
      );
    }

    // Créer un enregistrement de génération
    await db.run(
      'INSERT INTO devoir_quiz_generation (devoir_id, user_id, status) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, 'pending']
    );

    // Lancer la génération en arrière-plan
    generateQuizInBackground(
      req.params.id,
      devoir,
      req.user,
      fichiers
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

async function generateQuizInBackground(devoirId, devoir, user, fichiersIds) {
  try {
    // S'assurer que dotenv est chargé
    require('dotenv').config();
    
    const { generateQuizWithAI } = require('../services/quizGenerator');
    
    // Récupérer les informations complètes des fichiers
    const fichiers = await db.all(
      'SELECT filename, original_name FROM devoir_fichiers WHERE devoir_id = ?',
      [devoirId]
    );
    
    const questions = await generateQuizWithAI(
      devoir,
      user.premium,
      fichiers
    );

    // Sauvegarder le quiz
    await db.run(
      'INSERT INTO devoir_quiz (devoir_id, questions_json, mode) VALUES (?, ?, ?)',
      [devoirId, JSON.stringify(questions), 'both']
    );

    // Mettre à jour le statut de génération
    await db.run(
      'UPDATE devoir_quiz_generation SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE devoir_id = ?',
      ['completed', devoirId]
    );

    // Envoyer un email
    if (user.email) {
      const { sendQuizReadyEmail } = require('../services/email');
      await sendQuizReadyEmail(
        user.email,
        devoir.titre,
        devoirId
      );
    }

    console.log(`Quiz généré avec succès pour le devoir ${devoirId}`);
  } catch (error) {
    console.error(`Erreur lors de la génération du quiz pour le devoir ${devoirId}:`, error);

    // Mettre à jour le statut de génération
    await db.run(
      'UPDATE devoir_quiz_generation SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE devoir_id = ?',
      ['failed', error.message, devoirId]
    );
  }
}

module.exports = router;
