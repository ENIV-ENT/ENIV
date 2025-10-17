// Migration: Ajouter les champs email, nom et prenom à la table users

module.exports = {
  up: (db) => {
    console.log('Migration 001: Ajout des champs email, nom et prenom à la table users');

    // Vérifier si les colonnes existent déjà
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columns = tableInfo.map(col => col.name);

    // Ajouter la colonne email si elle n'existe pas
    if (!columns.includes('email')) {
      db.prepare('ALTER TABLE users ADD COLUMN email TEXT').run();
      console.log('  ✓ Colonne email ajoutée');
    } else {
      console.log('  - Colonne email déjà existante');
    }

    // Ajouter la colonne nom si elle n'existe pas
    if (!columns.includes('nom')) {
      db.prepare('ALTER TABLE users ADD COLUMN nom TEXT').run();
      console.log('  ✓ Colonne nom ajoutée');
    } else {
      console.log('  - Colonne nom déjà existante');
    }

    // Ajouter la colonne prenom si elle n'existe pas
    if (!columns.includes('prenom')) {
      db.prepare('ALTER TABLE users ADD COLUMN prenom TEXT').run();
      console.log('  ✓ Colonne prenom ajoutée');
    } else {
      console.log('  - Colonne prenom déjà existante');
    }
  },

  down: (db) => {
    console.log('Migration 001 (rollback): Suppression des champs email, nom et prenom');
    console.log('  Note: SQLite ne supporte pas ALTER TABLE DROP COLUMN avant la version 3.35.0');
    console.log('  Il faudrait recréer la table pour supprimer ces colonnes');
  }
};
