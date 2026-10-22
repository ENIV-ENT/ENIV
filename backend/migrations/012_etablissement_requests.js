module.exports = {
  up: async (pool) => {
    console.log('Migration 012: create table etablissement_requests');
    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS etablissement_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nom VARCHAR(255) NOT NULL,
          commune VARCHAR(255),
          code_postal VARCHAR(10),
          email_demandeur VARCHAR(255),
          status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('  + Table etablissement_requests created');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 012 (rollback): drop table etablissement_requests');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS etablissement_requests');
      console.log('  - Table etablissement_requests dropped');
    } finally {
      connection.release();
    }
  }
};
