const express = require('express');
const path = require('path');
const db = require('../models/dbHelper');
const { readFileToken } = require('../services/fileLinks');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '../uploads');

/**
 * Types served as is. The type comes from the saved extension, never from the
 * browser that uploaded the file: everything else is offered as a download, so a
 * booby-trapped file (.html, .svg...) never runs on the app's domain.
 */
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

/** Content-Disposition with the original name (accents included, RFC 6266). */
function contentDisposition(inline, name) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Attached file, through a temporary link obtained by a member of the class. */
router.get('/:token', async (req, res) => {
  const fileId = readFileToken(req.params.token);
  if (!fileId) {
    return res.status(403).type('text/plain').send('Lien expiré : rouvrez le document depuis Eniv.');
  }

  try {
    const file = await db.get('SELECT filename, original_name FROM devoir_fichiers WHERE id = ?', [fileId]);
    if (!file) {
      return res.status(404).type('text/plain').send('Document introuvable');
    }

    const filename = path.basename(file.filename);
    const { type, inline = false } = TYPES[path.extname(filename).toLowerCase()] || DEFAULT_TYPE;

    res.sendFile(filename, {
      root: UPLOADS_DIR,
      headers: {
        'Content-Type': type,
        'Content-Disposition': contentDisposition(inline, file.original_name || filename),
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
