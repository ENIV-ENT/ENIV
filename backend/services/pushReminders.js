const db = require('../models/dbHelper');
const push = require('./push');
const { dayBeforeReminder } = require('./pushMessages');

const TIMEZONE = 'Europe/Paris';

/** Tomorrow's date (YYYY-MM-DD) in the school's time zone. */
function tomorrowInParis(now = new Date()) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(tomorrow);
}

/**
 * Groups by student tomorrow's assignments they have not checked yet.
 * @param {Array<{user_id, id, titre, matiere_nom}>} rows
 * @returns {Map<number, Array>}
 */
function groupByUser(rows) {
  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push({ id: row.id, titre: row.titre, matiere_nom: row.matiere_nom });
  }
  return byUser;
}

/**
 * Day-before reminder: each subscribed student gets the list of tomorrow's
 * assignments they have not marked as done yet. Nothing is sent to those who
 * finished everything. Sends run in parallel: a student whose send fails or lags
 * does not deprive the others.
 */
async function sendDayBeforeReminders(now = new Date()) {
  const date = tomorrowInParis(now);

  const rows = await db.all(
    `SELECT u.id AS user_id, d.id, d.titre, m.nom AS matiere_nom
     FROM users u
     JOIN devoirs d ON d.classe_id = u.classe_id
     LEFT JOIN matieres m ON m.id = d.matiere_id
     LEFT JOIN devoir_statuts ds ON ds.devoir_id = d.id AND ds.user_id = u.id
     LEFT JOIN push_preferences pp ON pp.user_id = u.id
     WHERE d.date >= ? AND d.date < DATE_ADD(?, INTERVAL 1 DAY)
       AND COALESCE(ds.fait, 0) = 0
       AND COALESCE(pp.rappel_veille, TRUE)
       AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)
     ORDER BY u.id, m.nom, d.id`,
    [date, date]
  );

  const byUser = groupByUser(rows);
  let sent = 0;
  await Promise.all([...byUser].map(async ([userId, assignments]) => {
    try {
      sent += (await push.sendToUser(userId, dayBeforeReminder(assignments))).sent;
    } catch (error) {
      console.error(`Day-before push reminder failed for user ${userId}:`, error);
    }
  }));

  console.log(`Day-before push reminders (${date}): ${byUser.size} student(s), ${sent} notification(s)`);
  return { date, users: byUser.size, sent };
}

module.exports = { sendDayBeforeReminders, tomorrowInParis, groupByUser };
