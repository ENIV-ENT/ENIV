const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { fetchImage, ProxyError, MAX_BYTES } = require('../services/imageProxy');

const router = express.Router();

router.use(requireAuth);

/**
 * A remote image rarely changes: the browser cache avoids asking the server for
 * the same image each time an assignment is opened.
 */
const CACHE_MAX_AGE_SECONDS = 3600;

/**
 * Serves a remote image by fetching it on the server side.
 * The browser only contacts this domain, so the student's IP address stays private.
 *
 * - The image is served from our domain: it must only be read as an image, and be
 *   unable to load anything itself (nosniff, CSP default-src 'none').
 * - Content-Length is only declarative: the received bytes are counted again so a
 *   host cannot send an endless stream.
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

    console.error('Image proxy:', error);
    return res.status(502).json({ error: "Impossible de récupérer l'image" });
  }

  res.setHeader('Content-Type', image.contentType);
  if (image.contentLength !== null) {
    res.setHeader('Content-Length', image.contentLength);
  }
  res.setHeader('Cache-Control', `private, max-age=${CACHE_MAX_AGE_SECONDS}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Content-Disposition', 'inline');

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
