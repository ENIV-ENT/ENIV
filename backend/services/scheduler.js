const cron = require('node-cron');
const { envoyerRecapitulatifQuotidien } = require('./discord');

/**
 * Initialise le planificateur de tâches
 */
function initScheduler() {
  // Récapitulatif Discord à 18h00
  cron.schedule('00 18 * * *', async () => {
    console.log('Exécution de la tâche planifiée: envoi du récapitulatif quotidien');
    try {
      await envoyerRecapitulatifQuotidien();
    } catch (error) {
      console.error('Erreur lors de l\'exécution de la tâche planifiée:', error);
    }
  }, {
    timezone: "Europe/Paris"
  });

  console.log('Planificateur initialisé: récapitulatif quotidien à 18h00');
}

module.exports = {
  initScheduler
};
