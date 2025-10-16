const { exec } = require('child_process');
const crypto = require('crypto');

/**
 * Vérifie la signature du webhook GitHub
 * @param {string} signature - Signature GitHub (header x-hub-signature-256)
 * @param {string} payload - Corps de la requête
 * @param {string} secret - Secret configuré dans GitHub
 * @returns {boolean}
 */
function verifySignature(signature, payload, secret) {
  if (!signature || !secret) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

/**
 * Exécute les commandes de déploiement
 * @param {string} branch - Branche à déployer
 * @returns {Promise}
 */
function deploy(branch = 'main') {
  return new Promise((resolve, reject) => {
    const commands = [
      'git fetch origin',
      `git reset --hard origin/${branch}`,
      'npm install --production',
    ].join(' && ');

    console.log(`[DEPLOY] Démarrage du déploiement de la branche ${branch}...`);

    exec(commands, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error('[DEPLOY] Erreur:', error);
        reject(error);
        return;
      }

      if (stderr) {
        console.log('[DEPLOY] Stderr:', stderr);
      }

      console.log('[DEPLOY] Stdout:', stdout);
      console.log('[DEPLOY] Déploiement terminé avec succès');

      // Redémarrer le serveur après un court délai
      setTimeout(() => {
        console.log('[DEPLOY] Redémarrage du serveur...');
        process.exit(0); // PM2/systemd/supervisor redémarrera automatiquement
      }, 1000);

      resolve({ success: true, output: stdout });
    });
  });
}

/**
 * Gère les webhooks GitHub
 * @param {Request} req - Requête Express
 * @param {Response} res - Réponse Express
 */
async function handleWebhook(req, res) {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  const payload = JSON.stringify(req.body);

  // Vérifier la signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!verifySignature(signature, payload, secret)) {
    console.error('[DEPLOY] Signature invalide');
    return res.status(401).json({ error: 'Signature invalide' });
  }

  // Gérer uniquement les événements push
  if (event !== 'push') {
    console.log(`[DEPLOY] Événement ignoré: ${event}`);
    return res.json({ message: 'Événement ignoré', event });
  }

  const { ref, repository } = req.body;
  const branch = ref?.split('/').pop();

  console.log(`[DEPLOY] Push reçu sur ${repository?.name}:${branch}`);

  // Déployer uniquement pour la branche main (ou master)
  if (branch === 'main' || branch === 'master') {
    try {
      res.json({ message: 'Déploiement démarré', branch });
      await deploy(branch);
    } catch (error) {
      console.error('[DEPLOY] Erreur de déploiement:', error);
      // La réponse a déjà été envoyée, on ne peut plus envoyer d'erreur
    }
  } else {
    res.json({ message: 'Branche ignorée', branch });
  }
}

module.exports = {
  verifySignature,
  deploy,
  handleWebhook
};
