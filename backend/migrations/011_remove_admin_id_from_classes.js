// Migration: supprimer admin_id de la table classes

module.exports = {
  up: async (pool) => {
    console.log('Migration 011: Suppression de admin_id sur classes');

    const connection = await pool.getConnection();
    try {
      const [classeCols] = await connection.query('SHOW COLUMNS FROM classes');
      const classeColumns = classeCols.map(col => col.Field);

      if (!classeColumns.includes('admin_id')) {
        console.log('  - Colonne admin_id inexistante, rien a faire');
        return;
      }

      const [fkRows] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'classes'
          AND COLUMN_NAME = 'admin_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      for (const { CONSTRAINT_NAME } of fkRows) {
        await connection.query(`ALTER TABLE classes DROP FOREIGN KEY ${CONSTRAINT_NAME}`);
        console.log(`  - Contrainte ${CONSTRAINT_NAME} supprimee`);
      }

      await connection.query('ALTER TABLE classes DROP COLUMN admin_id');
      console.log('  - Colonne admin_id supprimee');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 011 (rollback): Ajout de admin_id sur classes');

    const connection = await pool.getConnection();
    try {
      const [classeCols] = await connection.query('SHOW COLUMNS FROM classes');
      const classeColumns = classeCols.map(col => col.Field);

      if (classeColumns.includes('admin_id')) {
        console.log('  - Colonne admin_id deja presente, rien a faire');
        return;
      }

      await connection.query(`
        ALTER TABLE classes
        ADD COLUMN admin_id INT,
        ADD CONSTRAINT fk_classes_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
      `);

      await connection.query(`
        UPDATE classes c
        SET c.admin_id = (
          SELECT u.id FROM users u WHERE u.role = 'admin' AND u.classe_id = c.id LIMIT 1
        )
        WHERE c.admin_id IS NULL
      `);

      console.log('  + Colonne admin_id ajoutee et renseignee');
    } finally {
      connection.release();
    }
  }
};
