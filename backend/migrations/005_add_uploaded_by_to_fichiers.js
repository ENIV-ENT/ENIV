module.exports = {
  up: async (pool) => {
    console.log('Migration 005: add uploaded_by to devoir_fichiers');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE devoir_fichiers
        ADD COLUMN uploaded_by INT,
        ADD FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('  ✓ Column uploaded_by added');

      await connection.query(`
        CREATE INDEX idx_uploaded_by ON devoir_fichiers(uploaded_by)
      `);
      console.log('  ✓ Index created on uploaded_by');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 005 (rollback): drop uploaded_by');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP INDEX idx_uploaded_by ON devoir_fichiers');
      console.log('  ✓ Index dropped');

      await connection.query('ALTER TABLE devoir_fichiers DROP COLUMN uploaded_by');
      console.log('  ✓ Column uploaded_by dropped');
    } finally {
      connection.release();
    }
  }
};
