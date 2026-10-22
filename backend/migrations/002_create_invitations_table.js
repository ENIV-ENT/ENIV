module.exports = {
  up: async (pool) => {
    console.log('Migration 002: create table invitations');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS invitations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          token VARCHAR(255) UNIQUE NOT NULL,
          role ENUM('admin', 'eleve') NOT NULL,
          classe_id INT,
          created_by INT NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          used BOOLEAN DEFAULT 0,
          used_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id)
        )
      `);

      console.log('  ✓ Table invitations created');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 002 (rollback): drop table invitations');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS invitations');
      console.log('  ✓ Table invitations dropped');
    } finally {
      connection.release();
    }
  }
};
