module.exports = {
  up: async (pool) => {
    console.log('Migration 013: add last_login_at to users');

    const connection = await pool.getConnection();
    try {
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM users");
      const columns = tableInfo.map(col => col.Field);

      if (!columns.includes('last_login_at')) {
        await connection.query('ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL');
        console.log('  ✓ Column last_login_at added');
      } else {
        console.log('  - Column last_login_at already exists');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 013 (rollback): drop last_login_at');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN last_login_at');
      console.log('  ✓ Column last_login_at dropped');
    } finally {
      connection.release();
    }
  }
};
