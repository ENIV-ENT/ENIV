const db = require('../models/database');

/**
 * Envoie un embed Discord via webhook
 * @param {string} webhookUrl - URL du webhook Discord
 * @param {Object} embed - Objet embed à envoyer
 * @returns {Promise<boolean>} - True si l'envoi a réussi
 */
async function sendDiscordEmbed(webhookUrl, embed) {
  if (!webhookUrl) {
    console.log('Pas de webhook Discord configuré');
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erreur Discord webhook:', response.status, errorText);
      return false;
    }

    console.log('Message Discord envoyé avec succès');
    return true;
  } catch (error) {
    console.error('Erreur lors de l\'envoi du message Discord:', error);
    return false;
  }
}

/**
 * Récupère tous les devoirs pour le lendemain, groupés par classe
 * @returns {Object} - Devoirs groupés par classe
 */
function getDevoirsPourDemain() {
  try {
    // Calculer la date de demain au format YYYY-MM-DD (local)
    const demain = new Date();
    demain.setDate(demain.getDate() + 1);

    // Formater la date en YYYY-MM-DD (local)
    const annee = demain.getFullYear();
    const mois = String(demain.getMonth() + 1).padStart(2, '0');
    const jour = String(demain.getDate()).padStart(2, '0');
    const dateDemain = `${annee}-${mois}-${jour}`;

    // Récupérer tous les devoirs pour demain avec les informations de matière et classe
    const devoirs = db.prepare(`
      SELECT
        d.id,
        d.titre,
        d.description,
        d.date,
        d.classe_id,
        m.nom as matiere_nom,
        m.couleur as matiere_couleur,
        c.nom as classe_nom
      FROM devoirs d
      JOIN matieres m ON d.matiere_id = m.id
      JOIN classes c ON d.classe_id = c.id
      WHERE d.date = ?
      ORDER BY d.classe_id, m.nom
    `).all(dateDemain);

    // Grouper par classe
    const devoirsParClasse = {};
    devoirs.forEach(devoir => {
      if (!devoirsParClasse[devoir.classe_id]) {
        devoirsParClasse[devoir.classe_id] = {
          classe_nom: devoir.classe_nom,
          devoirs: []
        };
      }
      devoirsParClasse[devoir.classe_id].devoirs.push(devoir);
    });

    return devoirsParClasse;
  } catch (error) {
    console.error('Erreur lors de la récupération des devoirs:', error);
    return {};
  }
}

/**
 * Envoie un récapitulatif quotidien des devoirs pour toutes les classes
 */
async function envoyerRecapitulatifQuotidien() {
  console.log('Envoi du récapitulatif quotidien des devoirs...');

  const devoirsParClasse = getDevoirsPourDemain();

  if (Object.keys(devoirsParClasse).length === 0) {
    console.log('Aucun devoir pour demain');
    return;
  }

  // Pour chaque classe, envoyer un message Discord si un webhook est configuré
  for (const [classeId, classeData] of Object.entries(devoirsParClasse)) {
    try {
      // Récupérer le webhook de la classe
      const key = `discord_webhook_${classeId}`;
      const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);

      if (!setting || !setting.value) {
        console.log(`Pas de webhook configuré pour la classe ${classeData.classe_nom}`);
        continue;
      }

      // Créer l'embed
      const embed = creerEmbedRecapitulatif(classeData);

      // Envoyer le message
      await sendDiscordEmbed(setting.value, embed);

      console.log(`Récapitulatif envoyé pour la classe ${classeData.classe_nom}`);
    } catch (error) {
      console.error(`Erreur lors de l'envoi pour la classe ${classeId}:`, error);
    }
  }
}

/**
 * Crée un embed Discord pour le récapitulatif des devoirs
 * @param {Object} classeData - Données de la classe et ses devoirs
 * @returns {Object} - Embed Discord
 */
function creerEmbedRecapitulatif(classeData) {
  const demain = new Date();
  demain.setDate(demain.getDate() + 1);

  const dateFormatee = demain.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const fields = classeData.devoirs.map(devoir => ({
    name: `${devoir.matiere_nom}`,
    value: devoir.description || devoir.titre,
    inline: false
  }));

  return {
    title: `📚 Devoirs pour ${dateFormatee}`,
    description: `Récapitulatif des devoirs pour la classe **${classeData.classe_nom}**`,
    color: 0x4A90E2, // Bleu
    fields: fields,
    footer: {
      text: `ENT - ${classeData.devoirs.length} devoir${classeData.devoirs.length > 1 ? 's' : ''} à faire`
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Récupère le webhook Discord pour une classe donnée
 * @param {number} classeId - ID de la classe
 * @returns {string|null} - URL du webhook ou null
 */
function getWebhookForClasse(classeId) {
  try {
    const key = `discord_webhook_${classeId}`;
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return setting ? setting.value : null;
  } catch (error) {
    console.error('Erreur lors de la récupération du webhook:', error);
    return null;
  }
}

module.exports = {
  sendDiscordEmbed,
  envoyerRecapitulatifQuotidien,
  getDevoirsPourDemain,
  creerEmbedRecapitulatif,
  getWebhookForClasse
};
