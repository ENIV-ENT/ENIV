module.exports = {
  up: async (pool) => {
    console.log('Migration 013: Ajout du champ last_login_at à la table users');

    const connection = await pool.getConnection();
    try {
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM users");
      const columns = tableInfo.map(col => col.Field);

      if (!columns.includes('last_login_at')) {
        await connection.query('ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL');
        console.log('  ✓ Colonne last_login_at ajoutée');
      } else {
        console.log('  - Colonne last_login_at déjà existante');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 013 (rollback): Suppression du champ last_login_at');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN last_login_at');
      console.log('  ✓ Colonne last_login_at supprimée');
    } finally {
      connection.release();
    }
  }
};
