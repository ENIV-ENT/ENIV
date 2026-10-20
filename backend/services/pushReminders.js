const db = require('../models/dbHelper');
const push = require('./push');
const { rappelVeille } = require('./pushMessages');

const TIMEZONE = 'Europe/Paris';

// Date de demain (YYYY-MM-DD) dans le fuseau de l'établissement
function demainParis(now = new Date()) {
  const demain = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(demain);
}

/**
 * Regroupe par élève les devoirs de demain qu'il n'a pas encore cochés.
 * @param {Array<{user_id, id, titre, matiere_nom}>} rows
 * @returns {Map<number, Array>}
 */
function grouperParUtilisateur(rows) {
  const parUtilisateur = new Map();
  for (const row of rows) {
    if (!parUtilisateur.has(row.user_id)) parUtilisateur.set(row.user_id, []);
    parUtilisateur.get(row.user_id).push({ id: row.id, titre: row.titre, matiere_nom: row.matiere_nom });
  }
  return parUtilisateur;
}

/**
 * Rappel de la veille : chaque élève abonné reçoit la liste des devoirs pour
 * demain qu'il n'a pas encore marqués comme faits. Rien n'est envoyé à qui a
 * tout fini.
 */
async function envoyerRappelsVeille(now = new Date()) {
  const date = demainParis(now);

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

  const parUtilisateur = grouperParUtilisateur(rows);
  let envoyes = 0;
  // En parallèle : un élève dont l'envoi échoue ou traîne ne prive pas les autres
  await Promise.all([...parUtilisateur].map(async ([userId, devoirs]) => {
    try {
      envoyes += (await push.sendToUser(userId, rappelVeille(devoirs))).sent;
    } catch (error) {
      console.error(`Rappel push de la veille échoué pour l'utilisateur ${userId}:`, error);
    }
  }));

  console.log(`Rappels push de la veille (${date}) : ${parUtilisateur.size} élève(s), ${envoyes} notification(s)`);
  return { date, utilisateurs: parUtilisateur.size, envoyes };
}

module.exports = { envoyerRappelsVeille, demainParis, grouperParUtilisateur };
