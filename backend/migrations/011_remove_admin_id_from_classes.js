module.exports = {
  up: async (pool) => {
    console.log('Migration 011: drop admin_id from classes');

    const connection = await pool.getConnection();
    try {
      const [classCols] = await connection.query('SHOW COLUMNS FROM classes');
      const classColumns = classCols.map(col => col.Field);

      if (!classColumns.includes('admin_id')) {
        console.log('  - Column admin_id does not exist, nothing to do');
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

      for (const { CONSTRAINT_NAME: constraintName } of fkRows) {
        await connection.query(`ALTER TABLE classes DROP FOREIGN KEY ${constraintName}`);
        console.log(`  - Constraint ${constraintName} dropped`);
      }

      await connection.query('ALTER TABLE classes DROP COLUMN admin_id');
      console.log('  - Column admin_id dropped');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 011 (rollback): add admin_id to classes');

    const connection = await pool.getConnection();
    try {
      const [classCols] = await connection.query('SHOW COLUMNS FROM classes');
      const classColumns = classCols.map(col => col.Field);

      if (classColumns.includes('admin_id')) {
        console.log('  - Column admin_id already exists, nothing to do');
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

      console.log('  + Column admin_id added and filled');
    } finally {
      connection.release();
    }
  }
};
