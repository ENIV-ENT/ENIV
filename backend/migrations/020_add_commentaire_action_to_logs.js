module.exports = {
  up: async (pool) => {
    console.log('Migration 020: add the delete_commentaire action to devoir_logs');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete', 'upload_pdf', 'delete_pdf', 'delete_commentaire') NOT NULL
      `);
      console.log('  ✓ Action delete_commentaire added');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 020 (rollback): remove the delete_commentaire action from devoir_logs');
    const connection = await pool.getConnection();
    try {
      await connection.query("DELETE FROM devoir_logs WHERE action = 'delete_commentaire'");
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete', 'upload_pdf', 'delete_pdf') NOT NULL
      `);
      console.log('  ✓ Action delete_commentaire removed');
    } finally {
      connection.release();
    }
  }
};
