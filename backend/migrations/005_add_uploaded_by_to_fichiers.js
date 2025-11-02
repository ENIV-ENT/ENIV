// Migration: Ajouter le champ uploaded_by à la table devoir_fichiers

module.exports = {
  up: async (pool) => {
    console.log('Migration 005: Ajout du champ uploaded_by à devoir_fichiers');

    const connection = await pool.getConnection();
    try {
      // Ajouter la colonne uploaded_by
      await connection.query(`
        ALTER TABLE devoir_fichiers
        ADD COLUMN uploaded_by INT,
        ADD FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('  ✓ Colonne uploaded_by ajoutée');

      // Ajouter un index pour optimiser les requêtes
      await connection.query(`
        CREATE INDEX idx_uploaded_by ON devoir_fichiers(uploaded_by)
      `);
      console.log('  ✓ Index créé sur uploaded_by');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 005 (rollback): Suppression du champ uploaded_by');
    const connection = await pool.getConnection();
    try {
      // Supprimer l'index
      await connection.query('DROP INDEX idx_uploaded_by ON devoir_fichiers');
      console.log('  ✓ Index supprimé');

      // Supprimer la colonne
      await connection.query('ALTER TABLE devoir_fichiers DROP COLUMN uploaded_by');
      console.log('  ✓ Colonne uploaded_by supprimée');
    } finally {
      connection.release();
    }
  }
};
