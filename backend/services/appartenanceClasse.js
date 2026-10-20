// Vérifications communes « cet objet appartient à la classe de l'utilisateur ».
// Les routes et le serveur MCP passent par ici pour qu'aucun accès n'oublie le
// filtre sur la classe.

const db = require('../models/dbHelper');

// La matière doit appartenir à la classe
async function matiereDeLaClasse(matiereId, classeId) {
  if (!classeId) return null;
  return db.get('SELECT id FROM matieres WHERE id = ? AND classe_id = ?', [matiereId, classeId]);
}

// Le devoir doit appartenir à la classe
async function devoirDeLaClasse(devoirId, classeId) {
  if (!classeId) return null;
  return db.get('SELECT id, titre FROM devoirs WHERE id = ? AND classe_id = ?', [devoirId, classeId]);
}

module.exports = { matiereDeLaClasse, devoirDeLaClasse };
