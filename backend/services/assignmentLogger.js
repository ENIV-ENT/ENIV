const db = require('../models/dbHelper');

/**
 * History of the actions on assignments (table devoir_logs).
 *
 * The details are stored as JSON in the `details` column. The `version` field lets
 * the frontend tell this format apart from older logs, which only held a subset of
 * the information and are shown in a degraded mode.
 * @module
 */

const DETAILS_VERSION = 2;

/** Assignment fields tracked in the history, in display order. */
const ASSIGNMENT_FIELDS = [
  { field: 'titre', label: 'Titre' },
  { field: 'description', label: 'Description' },
  { field: 'matiere_id', label: 'Matière' },
  { field: 'date', label: 'Pour le' }
];

/**
 * Normalizes a date to YYYY-MM-DD, whether it comes from MySQL (Date object) or
 * from a form (string), so no false change is detected between the old and the
 * new value. Dates are read in UTC like the mysql2 pool (timezone "Z"), so the day
 * does not shift with the server time zone.
 * @param {Date|string|null} value
 * @returns {string|null}
 */
function toDateString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }

  const text = String(value).trim();
  if (!text) return null;
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoDate ? isoDate[1] : text;
}

/**
 * Normalizes a text value: empty strings become null, so a cleared field and a
 * missing field are considered identical.
 * @param {*} value
 * @returns {string|null}
 */
function toText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text === '' ? null : text;
}

/**
 * Normalizes an id, which comes as a string from forms.
 * @param {*} value
 * @returns {number|null}
 */
function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  return Number.isNaN(id) ? null : id;
}

/**
 * Builds a snapshot of the tracked fields of an assignment.
 * @param {Object} source - assignment (SQL row or request body), optionally with matiere_nom
 * @returns {Object}
 */
function snapshotAssignment(source) {
  return {
    titre: toText(source.titre),
    description: toText(source.description),
    matiere_id: toId(source.matiere_id),
    matiere_nom: toText(source.matiere_nom),
    date: toDateString(source.date)
  };
}

/**
 * Compares two snapshots and returns the changed fields.
 * @param {Object} before
 * @param {Object} after
 * @returns {Array<Object>} list of { field, label, before, after } (+ before_label / after_label for the subject)
 */
function diffSnapshots(before, after) {
  const changes = [];

  for (const { field, label } of ASSIGNMENT_FIELDS) {
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
 * Writes an entry in the assignment history.
 *
 * A write error is logged but never thrown: the history must not make the user's
 * action fail, since it is already applied at this point.
 *
 * @param {Object} req - Express request (req.user must be set)
 * @param {Object} options
 * @param {number|string} options.assignmentId
 * @param {string} options.action - create | update | delete | upload_pdf | delete_pdf | delete_commentaire
 * @param {Object} options.details - details specific to the action
 * @returns {Promise<void>}
 */
async function logAssignmentAction(req, { assignmentId, action, details = {} }) {
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
      [assignmentId, action, user.id, user.username, user.classe_id, JSON.stringify(payload)]
    );
  } catch (error) {
    console.error(`Failed to write the "${action}" log of assignment ${assignmentId}:`, error);
  }
}

module.exports = {
  DETAILS_VERSION,
  ASSIGNMENT_FIELDS,
  toDateString,
  snapshotAssignment,
  diffSnapshots,
  logAssignmentAction
};
