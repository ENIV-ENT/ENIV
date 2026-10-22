const express = require('express');
const path = require('path');
const db = require('../models/dbHelper');
const { readFileToken } = require('../services/fileLinks');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Types servis tels quels. Le type vient de l'extension enregistrée, jamais du
// navigateur qui a déposé le fichier : tout le reste est proposé au
// téléchargement, pour qu'un fichier piégé (.html, .svg...) ne s'exécute jamais
// sur le domaine de l'application.
const TYPES = {
  '.pdf': { type: 'application/pdf', inline: true },
  '.doc': { type: 'application/msword' },
  '.docx': { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.ppt': { type: 'application/vnd.ms-powerpoint' },
  '.pptx': { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.xls': { type: 'application/vnd.ms-excel' },
  '.xlsx': { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
};
const DEFAULT_TYPE = { type: 'application/octet-stream' };

// Content-Disposition avec le nom d'origine (accents compris, RFC 6266)
function contentDisposition(inline, nom) {
  const ascii = nom.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

// Document joint, via un lien temporaire obtenu par un membre de la classe
router.get('/:token', async (req, res) => {
  const fichierId = readFileToken(req.params.token);
  if (!fichierId) {
    return res.status(403).type('text/plain').send('Lien expiré : rouvrez le document depuis Eniv.');
  }

  try {
    const fichier = await db.get('SELECT filename, original_name FROM devoir_fichiers WHERE id = ?', [fichierId]);
    if (!fichier) {
      return res.status(404).type('text/plain').send('Document introuvable');
    }

    const filename = path.basename(fichier.filename);
    const { type, inline = false } = TYPES[path.extname(filename).toLowerCase()] || DEFAULT_TYPE;

    res.sendFile(filename, {
      root: UPLOADS_DIR,
      headers: {
        'Content-Type': type,
        'Content-Disposition': contentDisposition(inline, fichier.original_name || filename),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    }, (error) => {
      if (error && !res.headersSent) {
        res.status(error.status === 404 ? 404 : 500).type('text/plain').send('Document introuvable');
      }
    });
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).type('text/plain').send('Erreur serveur');
  }
});

module.exports = router;
