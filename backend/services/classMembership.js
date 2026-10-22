/**
 * Shared "this object belongs to the user's class" checks.
 * Routes and the MCP server go through here so no access forgets the class filter.
 * @module
 */

const db = require('../models/dbHelper');

/**
 * @returns {Promise<{id: number}|null|undefined>} the subject, only if it belongs to the class
 */
async function findClassSubject(subjectId, classId) {
  if (!classId) return null;
  return db.get('SELECT id FROM matieres WHERE id = ? AND classe_id = ?', [subjectId, classId]);
}

/**
 * @returns {Promise<{id: number, titre: string}|null|undefined>} the assignment, only if it belongs to the class
 */
async function findClassAssignment(assignmentId, classId) {
  if (!classId) return null;
  return db.get('SELECT id, titre FROM devoirs WHERE id = ? AND classe_id = ?', [assignmentId, classId]);
}

module.exports = { findClassSubject, findClassAssignment };
