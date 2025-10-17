// Migration: Ajouter les champs email, nom et prenom à la table users

module.exports = {
  up: async (pool) => {
    console.log('Migration 001: Ajout des champs email, nom et prenom à la table users');

    const connection = await pool.getConnection();
    try {
      // Vérifier si les colonnes existent déjà
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM users");
      const columns = tableInfo.map(col => col.Field);

      // Ajouter la colonne email si elle n'existe pas
      if (!columns.includes('email')) {
        await connection.query('ALTER TABLE users ADD COLUMN email VARCHAR(255)');
        console.log('  ✓ Colonne email ajoutée');
      } else {
        console.log('  - Colonne email déjà existante');
      }

      // Ajouter la colonne nom si elle n'existe pas
      if (!columns.includes('nom')) {
        await connection.query('ALTER TABLE users ADD COLUMN nom VARCHAR(255)');
        console.log('  ✓ Colonne nom ajoutée');
      } else {
        console.log('  - Colonne nom déjà existante');
      }

      // Ajouter la colonne prenom si elle n'existe pas
      if (!columns.includes('prenom')) {
        await connection.query('ALTER TABLE users ADD COLUMN prenom VARCHAR(255)');
        console.log('  ✓ Colonne prenom ajoutée');
      } else {
        console.log('  - Colonne prenom déjà existante');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 001 (rollback): Suppression des champs email, nom et prenom');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN email');
      await connection.query('ALTER TABLE users DROP COLUMN nom');
      await connection.query('ALTER TABLE users DROP COLUMN prenom');
      console.log('  ✓ Colonnes supprimées');
    } finally {
      connection.release();
    }
  }
};
