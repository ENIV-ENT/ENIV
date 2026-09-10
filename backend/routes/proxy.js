const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { fetchImage, ProxyError, MAX_BYTES } = require('../services/imageProxy');

const router = express.Router();

router.use(requireAuth);

// Une image distante change rarement : le cache du navigateur évite de
// redemander la même image au serveur à chaque ouverture d'un devoir
const CACHE_MAX_AGE_SECONDS = 3600;

/**
 * Sert une image distante en la récupérant côté serveur.
 * Le navigateur ne contacte que ce domaine, l'adresse IP de l'élève reste privée.
 */
router.get('/image', async (req, res) => {
  const { url } = req.query;

  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: "Paramètre url manquant" });
  }

  let image;
  try {
    image = await fetchImage(url);
  } catch (error) {
    if (error instanceof ProxyError) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Proxy image:', error);
    return res.status(502).json({ error: "Impossible de récupérer l'image" });
  }

  res.setHeader('Content-Type', image.contentType);
  if (image.contentLength !== null) {
    res.setHeader('Content-Length', image.contentLength);
  }
  res.setHeader('Cache-Control', `private, max-age=${CACHE_MAX_AGE_SECONDS}`);
  // L'image est servie depuis notre domaine : elle ne doit être interprétée
  // que comme une image, et ne rien pouvoir charger elle-même
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Content-Disposition', 'inline');

  // Content-Length est déclaratif : on recompte les octets reçus pour qu'un
  // hébergeur ne puisse pas envoyer un flux sans fin
  let received = 0;
  image.stream.on('data', chunk => {
    received += chunk.length;
    if (received > MAX_BYTES) {
      image.stream.destroy();
      res.destroy();
    }
  });

  image.stream.on('error', () => res.destroy());
  image.stream.pipe(res);
});

module.exports = router;
