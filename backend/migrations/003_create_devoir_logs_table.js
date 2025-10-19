// Migration: Créer la table de logs pour les devoirs

module.exports = {
  up: async (pool) => {
    console.log('Migration 003: Création de la table devoir_logs');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS devoir_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          devoir_id INT,
          action ENUM('create', 'update', 'delete') NOT NULL,
          user_id INT NOT NULL,
          username VARCHAR(255),
          classe_id INT NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE,
          INDEX idx_classe_created (classe_id, created_at DESC),
          INDEX idx_devoir (devoir_id)
        )
      `);
      console.log('  ✓ Table devoir_logs créée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 003 (rollback): Suppression de la table devoir_logs');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS devoir_logs');
      console.log('  ✓ Table devoir_logs supprimée');
    } finally {
      connection.release();
    }
  }
};
