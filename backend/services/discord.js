const db = require('../models/dbHelper');

/**
 * Sends Discord embeds through a webhook.
 * @param {string} webhookUrl
 * @param {Array} embeds
 * @param {string} username - name shown for the webhook
 * @param {string} avatarUrl - avatar shown for the webhook
 * @returns {Promise<boolean>} true if the message was sent
 */
async function sendDiscordEmbeds(webhookUrl, embeds, username = null, avatarUrl = null) {
  if (!webhookUrl) {
    console.log('No Discord webhook configured');
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
      console.error('Discord webhook error:', response.status, errorText);
      return false;
    }

    console.log('Discord message sent');
    return true;
  } catch (error) {
    console.error('Failed to send the Discord message:', error);
    return false;
  }
}

/**
 * @param {Array<{classe_id: number, classe_nom: string}>} assignments
 * @returns {Object<number, {name: string, assignments: Array}>}
 */
function groupAssignmentsByClass(assignments) {
  const byClass = {};
  assignments.forEach(assignment => {
    if (!byClass[assignment.classe_id]) {
      byClass[assignment.classe_id] = {
        name: assignment.classe_nom,
        assignments: []
      };
    }
    byClass[assignment.classe_id].assignments.push(assignment);
  });
  return byClass;
}

function formatFrenchDate(date) {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/** Formats a date as YYYY-MM-DD, in local time. */
function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Gets every assignment due tomorrow, grouped by class.
 * @returns {Promise<Object>}
 */
async function getAssignmentsForTomorrow() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = formatDateString(tomorrow);

    const assignments = await db.all(
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
      [tomorrowDate]
    );

    return groupAssignmentsByClass(assignments);
  } catch (error) {
    console.error('Failed to get the assignments:', error);
    return {};
  }
}

function webhookUsername(schoolClass) {
  return `ENT - ${schoolClass.name}`;
}

function webhookAvatarUrl() {
  return process.env.BASE_URL ? `${process.env.BASE_URL}/images/logo.png` : null;
}

/**
 * Sends the daily summary of tomorrow's assignments to every class that has a
 * Discord webhook.
 */
async function sendDailySummary() {
  console.log('Sending the daily assignment summary...');

  const byClass = await getAssignmentsForTomorrow();

  if (Object.keys(byClass).length === 0) {
    console.log('No assignments for tomorrow');
    return;
  }

  for (const [classId, schoolClass] of Object.entries(byClass)) {
    try {
      const key = `discord_webhook_${classId}`;
      const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);

      if (!setting || !setting.value) {
        console.log(`No webhook configured for class ${schoolClass.name}`);
        continue;
      }

      const embed = createSummaryEmbed(schoolClass);
      await sendDiscordEmbeds(setting.value, [embed], webhookUsername(schoolClass), webhookAvatarUrl());

      console.log(`Summary sent for class ${schoolClass.name}`);
    } catch (error) {
      console.error(`Failed to send for class ${classId}:`, error);
    }
  }
}

/** Gets the assignments of next week (Monday to Sunday), grouped by class. */
async function getAssignmentsForNextWeek() {
  try {
    const today = new Date();
    const weekDay = today.getDay();
    const daysUntilNextMonday = (8 - weekDay) % 7;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilNextMonday);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);

    const startDate = formatDateString(nextMonday);
    const endDate = formatDateString(nextSunday);

    const assignments = await db.all(
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
      [startDate, endDate]
    );

    return groupAssignmentsByClass(assignments);
  } catch (error) {
    console.error('Failed to get the assignments of next week:', error);
    return {};
  }
}

/** Sends the weekly summary of next week's assignments, one embed per day. */
async function sendWeeklySummary() {
  console.log('Sending the weekly assignment summary...');

  const byClass = await getAssignmentsForNextWeek();
  if (Object.keys(byClass).length === 0) {
    console.log('No assignments for next week');
    return;
  }

  for (const [classId, schoolClass] of Object.entries(byClass)) {
    try {
      const key = `discord_webhook_${classId}`;
      const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);

      if (!setting || !setting.value) {
        console.log(`No webhook configured for class ${schoolClass.name}`);
        continue;
      }

      const embedStart = {
        title: `📚 Récapitulatif hebdomadaire des devoirs`,
        description: `Voici les devoirs prévus pour la semaine prochaine :`,
        color: 0x4A90E2,
      }

      const byDay = {};
      schoolClass.assignments.forEach(assignment => {
        const dateKey = formatDateString(assignment.date);
        if (!byDay[dateKey]) {
          byDay[dateKey] = [];
        }
        byDay[dateKey].push(assignment);
      });

      const daysEmbeds = Object.entries(byDay)
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, assignments]) => {
          const fields = assignments.map(assignment => ({
            name: `${assignment.matiere_nom}`,
            value: `**${assignment.titre}**\n${assignment.description ?? ""}`,
            inline: false
          }));

          return {
            title: `🗓️ Devoirs pour le ${formatFrenchDate(new Date(date))}`,
            description: "",
            color: 0x4A90E2,
            fields: fields,
          };
        });

      const embeds = [embedStart, ...daysEmbeds];
      embeds[embeds.length - 1].timestamp = new Date().toISOString();

      await sendDiscordEmbeds(setting.value, embeds, webhookUsername(schoolClass), webhookAvatarUrl());

      console.log(`Weekly summary sent for class ${schoolClass.name}`);
    } catch (error) {
      console.error(`Failed to send the weekly summary for class ${classId}:`, error);
    }
  }
}

/**
 * Creates the Discord embed of the daily summary.
 * @param {{name: string, assignments: Array}} schoolClass
 * @returns {Object}
 */
function createSummaryEmbed(schoolClass) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const formattedDate = formatFrenchDate(tomorrow);

  const fields = schoolClass.assignments.map(assignment => ({
    name: `${assignment.matiere_nom}`,
    value: `**${assignment.titre}**\n${assignment.description ?? ""}`,
    inline: false
  }));

  return {
    title: `📚 Devoirs pour ${formattedDate}`,
    description: "",
    color: 0x4A90E2,
    fields: fields,
    footer: {
      text: `ENT - ${schoolClass.assignments.length} devoir${schoolClass.assignments.length > 1 ? 's' : ''} à faire`
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Gets the Discord webhook of a class.
 * @param {number} classId
 * @returns {Promise<string|null>}
 */
async function getClassWebhook(classId) {
  try {
    const key = `discord_webhook_${classId}`;
    const setting = await db.get('SELECT value FROM settings WHERE `key` = ?', [key]);
    return setting ? setting.value : null;
  } catch (error) {
    console.error('Failed to get the webhook:', error);
    return null;
  }
}

module.exports = {
  sendDiscordEmbeds,
  sendDailySummary,
  sendWeeklySummary,
  getAssignmentsForTomorrow,
  createSummaryEmbed,
  getClassWebhook
};
