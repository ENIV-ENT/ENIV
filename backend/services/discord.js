const db = require('../models/dbHelper');

/**
 * Envoie un embed Discord via webhook
 * @param {string} webhookUrl - URL du webhook Discord
 * @param {Array} embeds - Array d'objets embed à envoyer
 * @param {string} username - Nom d'utilisateur du webhook
 * @param {string} avatarUrl - URL de l'avatar du webhook
 * @returns {Promise<boolean>} - True si l'envoi a réussi
 */
async function sendDiscordEmbeds(webhookUrl, embeds, username = null, avatarUrl = null) {
  if (!webhookUrl) {
    console.log('Pas de webhook Discord configuré');
    return false;
  }

  try {
    const payload = {
      embeds
    };

    if (username) {
      payload.username = username;
    }

    if (avatarUrl) {
      payload.avatar_url = avatarUrl;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
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

function groupDevoirsParClasse(devoirs) {
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
}

function formatDateFr(date) {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}


// Formater les dates en YYYY-MM-DD (local)
function formatDateString(date) {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

/**
 * Récupère tous les devoirs pour le lendemain, groupés par classe
 * @returns {Promise<Object>} - Devoirs groupés par classe
 */
async function getDevoirsPourDemain() {
  try {
    // Calculer la date de demain au format YYYY-MM-DD (local)
    const demain = new Date();
    demain.setDate(demain.getDate() + 1);
    const dateDemain = formatDateString(demain);

    // Récupérer tous les devoirs pour demain avec les informations de matière et classe
    const devoirs = await db.all(
      `SELECT
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
      ORDER BY d.classe_id, m.nom`,
      [dateDemain]
    );

    return groupDevoirsParClasse(devoirs);
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

  const devoirsParClasse = await getDevoirsPourDemain();

  if (Object.keys(devoirsParClasse).length === 0) {
    console.log('Aucun devoir pour demain');
    return;
  }

  // Pour chaque classe, envoyer un message Discord si un webhook est configuré
  for (const [classeId, classeData] of Object.entries(devoirsParClasse)) {
    try {
      // Récupérer le webhook de la classe
      const key = `discord_webhook_${classeId}`;
      const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);

      if (!setting || !setting.value) {
        console.log(`Pas de webhook configuré pour la classe ${classeData.classe_nom}`);
        continue;
      }

      // Créer l'embed
      const embed = creerEmbedRecapitulatif(classeData);

      // Envoyer le message avec le nom de la classe et le logo
      const username = `ENT - ${classeData.classe_nom}`;
      const avatarUrl = process.env.BASE_URL ? `${process.env.BASE_URL}/images/logo.png` : null;
      await sendDiscordEmbeds(setting.value, [embed], username, avatarUrl);

      console.log(`Récapitulatif envoyé pour la classe ${classeData.classe_nom}`);
    } catch (error) {
      console.error(`Erreur lors de l'envoi pour la classe ${classeId}:`, error);
    }
  }
}

async function getDevoirsPourSemaineProchaine() {
  try {
    // Calculer la date de début et de fin de la semaine prochaine (lundi à dimanche)
    const aujourdHui = new Date();
    const jourDeLaSemaine = aujourdHui.getDay(); // 0 (dimanche) à 6 (samedi)
    const joursJusquaLundiProchain = (8 - jourDeLaSemaine) % 7;
    const lundiProchain = new Date(aujourdHui);
    lundiProchain.setDate(aujourdHui.getDate() + joursJusquaLundiProchain);
    const dimancheProchain = new Date(lundiProchain);
    dimancheProchain.setDate(lundiProchain.getDate() + 6);


    const dateDebut = formatDateString(lundiProchain);
    const dateFin = formatDateString(dimancheProchain);

    // Récupérer tous les devoirs pour la semaine prochaine avec les informations de matière et classe
    const devoirs = await db.all(
      `SELECT
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
      WHERE d.date BETWEEN ? AND ?
      ORDER BY d.classe_id, m.nom, d.date`,
      [dateDebut, dateFin]
    );

    return groupDevoirsParClasse(devoirs);
  } catch (error) {
    console.error('Erreur lors de la récupération des devoirs pour la semaine prochaine:', error);
    return {};
  }
}

async function envoyerRecapitulatifHebdomadaire() {
  console.log('Envoi du récapitulatif hebdomadaire des devoirs...');

  const devoirsParClasse = await getDevoirsPourSemaineProchaine();
  if (Object.keys(devoirsParClasse).length === 0) {
    console.log('Aucun devoir pour la semaine prochaine');
    return;
  }

  for (const [classeId, classeData] of Object.entries(devoirsParClasse)) {
    try {
      const key = `discord_webhook_${classeId}`;
      const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);

      if (!setting || !setting.value) {
        console.log(`Pas de webhook configuré pour la classe ${classeData.classe_nom}`);
        continue;
      }

      const embedStart = {
        title: `📚 Récapitulatif hebdomadaire des devoirs`,
        description: `Voici les devoirs prévus pour la semaine prochaine :`,
        color: 0x4A90E2,
      }

      const devoirsParJour = {};
      classeData.devoirs.forEach(devoir => {
        const dateKey = formatDateString(devoir.date);
        if (!devoirsParJour[dateKey]) {
          devoirsParJour[dateKey] = [];
        }
        devoirsParJour[dateKey].push(devoir);
      });

      const daysEmbeds = Object.entries(devoirsParJour)
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, devoirs]) => {
          const fields = devoirs.map(devoir => ({
            name: `${devoir.matiere_nom}`,
            value: `**${devoir.titre}**\n${devoir.description ?? ""}`,
            inline: false
          }));

          return {
            title: `🗓️ Devoirs pour le ${formatDateFr(new Date(date))}`,
            description: "",
            color: 0x4A90E2,
            fields: fields,
          };
        });

      const embeds = [embedStart, ...daysEmbeds];
      embeds[embeds.length - 1].timestamp = new Date().toISOString();

      const username = `ENT - ${classeData.classe_nom}`;
      const avatarUrl = process.env.BASE_URL ? `${process.env.BASE_URL}/images/logo.png` : null;
      await sendDiscordEmbeds(setting.value, embeds, username, avatarUrl);

      console.log(`Récapitulatif hebdomadaire envoyé pour la classe ${classeData.classe_nom}`);
    } catch (error) {
      console.error(`Erreur lors de l'envoi du récapitulatif hebdomadaire pour la classe ${classeId}:`, error);
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

  const dateFormatee = formatDateFr(demain);

  const fields = classeData.devoirs.map(devoir => ({
    name: `${devoir.matiere_nom}`,
    value: `**${devoir.titre}**\n${devoir.description ?? ""}`,
    inline: false
  }));

  return {
    title: `📚 Devoirs pour ${dateFormatee}`,
    description: "",
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
 * @returns {Promise<string|null>} - URL du webhook ou null
 */
async function getWebhookForClasse(classeId) {
  try {
    const key = `discord_webhook_${classeId}`;
    const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);
    return setting ? setting.value : null;
  } catch (error) {
    console.error('Erreur lors de la récupération du webhook:', error);
    return null;
  }
}

module.exports = {
  sendDiscordEmbeds,
  envoyerRecapitulatifQuotidien,
  envoyerRecapitulatifHebdomadaire,
  getDevoirsPourDemain,
  creerEmbedRecapitulatif,
  getWebhookForClasse
};
