module.exports = {
  up: async (pool) => {
    console.log('Migration 006: add the PDF actions to devoir_logs');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete', 'upload_pdf', 'delete_pdf') NOT NULL
      `);
      console.log('  ✓ Actions upload_pdf and delete_pdf added');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 006 (rollback): remove the PDF actions from devoir_logs');
    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete') NOT NULL
      `);
      console.log('  ✓ Actions upload_pdf and delete_pdf removed');
    } finally {
      connection.release();
    }
  }
};
