const crypto = require('crypto');
const db = require('../models/dbHelper');
const { sendInvitationEmail } = require('./email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALIDITY_DAYS = 7;

function toMysqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Crée une invitation et envoie l'e-mail correspondant.
 *
 * Ne lève pas d'exception pour les cas « métier » : le résultat dit ce qui
 * s'est passé, ce qui permet de traiter une liste d'adresses sans s'arrêter à
 * la première déjà inscrite.
 *
 * @param {Object} options
 * @param {string} options.email
 * @param {'admin'|'eleve'} options.role
 * @param {number|null} options.classeId
 * @param {number} options.createdBy
 * @returns {Promise<{status: 'envoyee'|'invalide'|'deja_inscrit'|'deja_invite', invitationId?: number}>}
 */
async function createInvitation({ email, role, classeId, createdBy }) {
  if (!EMAIL_REGEX.test(email)) {
    return { status: 'invalide' };
  }

  const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existingUser) {
    return { status: 'deja_inscrit' };
  }

  const now = toMysqlDateTime(new Date());
  const existingInvitation = await db.get(
    'SELECT id FROM invitations WHERE email = ? AND used = 0 AND expires_at > ?',
    [email, now]
  );
  if (existingInvitation) {
    return { status: 'deja_invite' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + VALIDITY_DAYS);

  const result = await db.run(
    'INSERT INTO invitations (email, token, role, classe_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [email, token, role, classeId || null, createdBy, toMysqlDateTime(expiresAt)]
  );

  let className = null;
  if (classeId) {
    const classe = await db.get('SELECT nom FROM classes WHERE id = ?', [classeId]);
    className = classe ? classe.nom : null;
  }

  try {
    await sendInvitationEmail(email, token, role, className);
  } catch (error) {
    // Supprimer l'invitation si l'email n'a pas pu être envoyé
    await db.run('DELETE FROM invitations WHERE id = ?', [result.lastInsertRowid]);
    throw error;
  }

  return { status: 'envoyee', invitationId: result.lastInsertRowid };
}

module.exports = { createInvitation, EMAIL_REGEX };
