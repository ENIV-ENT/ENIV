const db = require('../models/dbHelper');

/**
 * Journalisation des actions effectuées sur les devoirs (table devoir_logs).
 *
 * Les détails sont stockés en JSON dans la colonne `details`. Le champ `version`
 * permet au frontend de distinguer ce format des logs plus anciens, qui ne
 * contenaient qu'un sous-ensemble d'informations et sont affichés en mode dégradé.
 */

const DETAILS_VERSION = 2;

// Champs du devoir suivis dans l'historique, dans l'ordre d'affichage
const DEVOIR_FIELDS = [
  { field: 'titre', label: 'Titre' },
  { field: 'description', label: 'Description' },
  { field: 'matiere_id', label: 'Matière' },
  { field: 'date', label: 'Pour le' }
];

/**
 * Normalise une date en YYYY-MM-DD, qu'elle vienne de MySQL (objet Date) ou
 * d'un formulaire (chaîne). Indispensable pour ne pas détecter de fausse
 * modification entre l'ancienne et la nouvelle valeur.
 * @param {Date|string|null} value
 * @returns {string|null}
 */
function toDateString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  const text = String(value).trim();
  if (!text) return null;
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoDate ? isoDate[1] : text;
}

/**
 * Normalise une valeur texte : les chaînes vides sont ramenées à null pour
 * qu'un champ effacé et un champ absent soient considérés identiques.
 * @param {*} value
 * @returns {string|null}
 */
function toText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text === '' ? null : text;
}

/**
 * Normalise un identifiant, qui arrive en chaîne depuis les formulaires.
 * @param {*} value
 * @returns {number|null}
 */
function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  return Number.isNaN(id) ? null : id;
}

/**
 * Construit un instantané des champs suivis d'un devoir.
 * @param {Object} source - Devoir (ligne SQL ou corps de requête), avec éventuellement matiere_nom
 * @returns {Object}
 */
function snapshotDevoir(source) {
  return {
    titre: toText(source.titre),
    description: toText(source.description),
    matiere_id: toId(source.matiere_id),
    matiere_nom: toText(source.matiere_nom),
    date: toDateString(source.date)
  };
}

/**
 * Compare deux instantanés et retourne la liste des champs modifiés.
 * @param {Object} before - Instantané avant modification
 * @param {Object} after - Instantané après modification
 * @returns {Array<Object>} Liste de { field, label, before, after } (+ before_label / after_label pour la matière)
 */
function diffSnapshots(before, after) {
  const changes = [];

  for (const { field, label } of DEVOIR_FIELDS) {
    if (before[field] === after[field]) continue;

    const change = { field, label, before: before[field], after: after[field] };
    if (field === 'matiere_id') {
      change.before_label = before.matiere_nom;
      change.after_label = after.matiere_nom;
    }
    changes.push(change);
  }

  return changes;
}

/**
 * Écrit une entrée dans l'historique des devoirs.
 *
 * Une erreur d'écriture est journalisée mais jamais propagée : l'historique ne
 * doit pas faire échouer l'action de l'utilisateur, déjà appliquée à ce stade.
 *
 * @param {Object} req - Requête Express (req.user doit être renseigné)
 * @param {Object} options
 * @param {number|string} options.devoirId - Devoir concerné
 * @param {string} options.action - create | update | delete | upload_pdf | delete_pdf
 * @param {Object} options.details - Détails spécifiques à l'action
 * @returns {Promise<void>}
 */
async function logDevoirAction(req, { devoirId, action, details = {} }) {
  const user = req.user;

  const payload = {
    version: DETAILS_VERSION,
    author: {
      nom: toText(user.nom),
      prenom: toText(user.prenom),
      role: user.role
    },
    ...details
  };

  try {
    await db.run(
      'INSERT INTO devoir_logs (devoir_id, action, user_id, username, classe_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [devoirId, action, user.id, user.username, user.classe_id, JSON.stringify(payload)]
    );
  } catch (error) {
    console.error(`Erreur lors de l'écriture du log "${action}" du devoir ${devoirId}:`, error);
  }
}

module.exports = {
  DETAILS_VERSION,
  DEVOIR_FIELDS,
  snapshotDevoir,
  diffSnapshots,
  logDevoirAction
};
