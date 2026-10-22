/**
 * Creates the comments under assignments. A comment disappears with its assignment
 * or with its author's account.
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 019: create table devoir_commentaires');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS devoir_commentaires (
          id INT AUTO_INCREMENT PRIMARY KEY,
          devoir_id INT NOT NULL,
          user_id INT NOT NULL,
          contenu TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_devoir_commentaires_devoir (devoir_id, created_at),
          FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      console.log('  ✓ Table devoir_commentaires created');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 019 (rollback): drop table devoir_commentaires');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS devoir_commentaires');
    } finally {
      connection.release();
    }
  }
};
