const express = require('express');
const { requireAuth } = require('../middleware/auth');
const push = require('../services/push');
const messages = require('../services/pushMessages');
const router = express.Router();

/** VAPID public key, needed by the browser to subscribe. */
router.get('/public-key', async (req, res) => {
  try {
    res.json({ publicKey: await push.getPublicKey() });
  } catch (error) {
    console.error('Error reading VAPID key:', error);
    res.status(500).json({ error: 'Notifications indisponibles' });
  }
});

router.use(requireAuth);

/** Saves the subscription of this browser. */
router.post('/subscribe', express.json(), async (req, res) => {
  const subscription = push.parseSubscription(req.body);
  if (!subscription) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  try {
    if (!await push.saveSubscription(req.user.id, subscription, req.headers['user-agent'])) {
      return res.status(409).json({ error: 'Trop d\'appareils reçoivent déjà les notifications de ce compte. Retirez un ancien appareil dans Paramètres › Notifications.' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    res.status(500).json({ error: "Erreur lors de l'activation des notifications" });
  }
});

router.post('/unsubscribe', express.json(), async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'Endpoint requis' });
  }

  try {
    await push.deleteSubscription(req.user.id, endpoint);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting push subscription:', error);
    res.status(500).json({ error: 'Erreur lors de la désactivation des notifications' });
  }
});

/** Subscribed devices of the account, to remove one that is no longer accessible. */
router.get('/subscriptions', async (req, res) => {
  try {
    res.json(await push.listSubscriptions(req.user.id));
  } catch (error) {
    console.error('Error listing push subscriptions:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des appareils' });
  }
});

router.delete('/subscriptions/:id', async (req, res) => {
  try {
    if (!await push.deleteSubscriptionById(req.user.id, req.params.id)) {
      return res.status(404).json({ error: 'Appareil introuvable' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting push subscription:', error);
    res.status(500).json({ error: 'Erreur lors du retrait de l\'appareil' });
  }
});

router.get('/preferences', async (req, res) => {
  try {
    res.json({ preferences: await push.getPreferences(req.user.id) });
  } catch (error) {
    console.error('Error reading push preferences:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des préférences' });
  }
});

router.put('/preferences', express.json(), async (req, res) => {
  try {
    const preferences = await push.setPreferences(req.user.id, req.body || {});
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error saving push preferences:', error);
    res.status(500).json({ error: "Erreur lors de l'enregistrement des préférences" });
  }
});

/** Test notification to every device of the user. */
router.post('/test', async (req, res) => {
  try {
    const stats = await push.sendToUser(req.user.id, messages.test());
    if (stats.sent === 0) {
      return res.status(404).json({ error: 'Aucun appareil abonné ne répond' });
    }
    res.json({ success: true, ...stats });
  } catch (error) {
    console.error('Error sending test push:', error);
    res.status(500).json({ error: "Erreur lors de l'envoi de la notification" });
  }
});

module.exports = router;
