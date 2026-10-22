module.exports = {
  up: async (pool) => {
    console.log('Migration 007: add premium to users');

    const connection = await pool.getConnection();
    try {
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM users");
      const columns = tableInfo.map(col => col.Field);

      if (!columns.includes('premium')) {
        await connection.query('ALTER TABLE users ADD COLUMN premium BOOLEAN DEFAULT FALSE');
        console.log('  ✓ Column premium added');
      } else {
        console.log('  - Column premium already exists');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 007 (rollback): drop premium');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN premium');
      console.log('  ✓ Column premium dropped');
    } finally {
      connection.release();
    }
  }
};
