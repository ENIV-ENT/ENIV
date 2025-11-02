// Migration: Ajouter le champ premium à la table users

module.exports = {
  up: async (pool) => {
    console.log('Migration 007: Ajout du champ premium à la table users');

    const connection = await pool.getConnection();
    try {
      // Vérifier si la colonne existe déjà
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM users");
      const columns = tableInfo.map(col => col.Field);

      // Ajouter la colonne premium si elle n'existe pas
      if (!columns.includes('premium')) {
        await connection.query('ALTER TABLE users ADD COLUMN premium BOOLEAN DEFAULT FALSE');
        console.log('  ✓ Colonne premium ajoutée');
      } else {
        console.log('  - Colonne premium déjà existante');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 007 (rollback): Suppression du champ premium');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN premium');
      console.log('  ✓ Colonne premium supprimée');
    } finally {
      connection.release();
    }
  }
};
