// Migration: Créer la table invitations pour gérer les invitations par email

module.exports = {
  up: (db) => {
    console.log('Migration 002: Création de la table invitations');

    db.exec(`
      CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'eleve')),
        classe_id INTEGER,
        created_by INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT 0,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    console.log('  ✓ Table invitations créée');
  },

  down: (db) => {
    console.log('Migration 002 (rollback): Suppression de la table invitations');
    db.prepare('DROP TABLE IF EXISTS invitations').run();
    console.log('  ✓ Table invitations supprimée');
  }
};
