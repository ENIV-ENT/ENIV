const cron = require('node-cron');
const { envoyerRecapitulatifQuotidien, envoyerRecapitulatifHebdomadaire } = require('./discord');
const { envoyerRappelsVeille } = require('./pushReminders');
const { refreshAll } = require('./emploiTemps');

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

  // Rappel push de la veille : devoirs de demain pas encore faits
  cron.schedule('00 18 * * *', async () => {
    try {
      await envoyerRappelsVeille();
    } catch (error) {
      console.error('Erreur lors de l\'envoi des rappels push:', error);
    }
  }, {
    timezone: "Europe/Paris"
  });

  cron.schedule("00 9 * * 6", async () => {
    console.log("Exécution de la tâche planifiée: envoi du récapitulatif hebdomadaire");
    try {
      await envoyerRecapitulatifHebdomadaire();
    } catch (error) {
      console.error("Erreur lors de l'exécution de la tâche planifiée:", error);
    }
  }, {
    timezone: "Europe/Paris"
  });

  // Emploi du temps ICS : la version gardée en base reste à jour même si
  // personne n'ouvre la page, et sert de secours quand la source tombe
  cron.schedule('*/30 * * * *', rafraichirEmploisDuTemps, {
    timezone: "Europe/Paris"
  });
  // Premier passage peu après le démarrage (migrations appliquées entre-temps)
  setTimeout(rafraichirEmploisDuTemps, 30 * 1000).unref();

  console.log('Planificateur initialisé: récapitulatif quotidien et rappels push à 18h00 & hebdomadaire le samedi à 9h00, emplois du temps toutes les 30 min');
}

let rafraichissementEnCours = false;

async function rafraichirEmploisDuTemps() {
  // Un passage lent ne doit pas se superposer au suivant
  if (rafraichissementEnCours) return;
  rafraichissementEnCours = true;

  try {
    const { ok, echecs } = await refreshAll();
    if (ok || echecs) {
      console.log(`Emplois du temps rafraîchis : ${ok} à jour, ${echecs} en échec`);
    }
  } catch (error) {
    console.error('Erreur lors du rafraîchissement des emplois du temps:', error);
  } finally {
    rafraichissementEnCours = false;
  }
}

module.exports = {
  initScheduler
};
