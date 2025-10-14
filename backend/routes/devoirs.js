const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../models/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Configuration multer pour upload de fichiers de devoirs
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../backend/uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Toutes les routes nécessitent authentification
router.use(requireAuth);

// Créer un devoir (tous les élèves peuvent créer)
router.post('/', upload.array('fichiers', 10), (req, res) => {
  const { titre, description, matiere_id, date_limite } = req.body;

  if (!titre || !matiere_id) {
    return res.status(400).json({ error: 'Titre et matière requis' });
  }

  try {
    // Créer le devoir
    const result = db.prepare(
      'INSERT INTO devoirs (titre, description, matiere_id, date_limite, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(titre, description || null, matiere_id, date_limite || null, req.session.userId);

    const devoirId = result.lastInsertRowid;

    // Ajouter les fichiers si présents
    if (req.files && req.files.length > 0) {
      const insertFile = db.prepare('INSERT INTO devoir_fichiers (devoir_id, filename, original_name) VALUES (?, ?, ?)');
      for (const file of req.files) {
        insertFile.run(devoirId, file.filename, file.originalname);
      }
    }

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

// Lister tous les devoirs avec leurs statuts
router.get('/', (req, res) => {
  try {
    const devoirs = db.prepare(`
      SELECT
        d.*,
        m.nom as matiere_nom,
        m.image as matiere_image,
        u.username as created_by_username,
        COALESCE(ds.fait, 0) as fait
      FROM devoirs d
      LEFT JOIN matieres m ON d.matiere_id = m.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?
      ORDER BY d.date_limite ASC, d.created_at DESC
    `).all(req.session.userId);

    // Récupérer les fichiers pour chaque devoir
    const devoirsAvecFichiers = devoirs.map(devoir => {
      const fichiers = db.prepare('SELECT id, original_name, filename FROM devoir_fichiers WHERE devoir_id = ?').all(devoir.id);
      return { ...devoir, fichiers };
    });

    res.json(devoirsAvecFichiers);
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

    const fichiers = db.prepare('SELECT id, original_name, filename FROM devoir_fichiers WHERE devoir_id = ?').all(devoir.id);
    devoir.fichiers = fichiers;

    res.json(devoir);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération du devoir' });
  }
});

// Modifier un devoir (tous les élèves peuvent modifier)
router.put('/:id', upload.array('fichiers', 10), (req, res) => {
  const { titre, description, matiere_id, date_limite } = req.body;

  try {
    db.prepare(
      'UPDATE devoirs SET titre = ?, description = ?, matiere_id = ?, date_limite = ? WHERE id = ?'
    ).run(titre, description || null, matiere_id, date_limite || null, req.params.id);

    // Ajouter les nouveaux fichiers si présents
    if (req.files && req.files.length > 0) {
      const insertFile = db.prepare('INSERT INTO devoir_fichiers (devoir_id, filename, original_name) VALUES (?, ?, ?)');
      for (const file of req.files) {
        insertFile.run(req.params.id, file.filename, file.originalname);
      }
    }

    res.json({ success: true, message: 'Devoir mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du devoir' });
  }
});

// Supprimer un devoir (tous les élèves peuvent supprimer)
router.delete('/:id', (req, res) => {
  try {
    // Supprimer les fichiers associés du système de fichiers
    const fichiers = db.prepare('SELECT filename FROM devoir_fichiers WHERE devoir_id = ?').all(req.params.id);
    for (const fichier of fichiers) {
      const filePath = path.join(__dirname, '../../backend/uploads', fichier.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    db.prepare('DELETE FROM devoirs WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Devoir supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression du devoir' });
  }
});

// Marquer un devoir comme fait/non fait
router.post('/:id/statut', (req, res) => {
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

// Télécharger un fichier
router.get('/fichiers/:filename', (req, res) => {
  try {
    const filePath = path.join(__dirname, '../../backend/uploads', req.params.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du téléchargement du fichier' });
  }
});

// Supprimer un fichier
router.delete('/fichiers/:id', (req, res) => {
  try {
    const fichier = db.prepare('SELECT filename FROM devoir_fichiers WHERE id = ?').get(req.params.id);

    if (!fichier) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    const filePath = path.join(__dirname, '../../backend/uploads', fichier.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM devoir_fichiers WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression du fichier' });
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
