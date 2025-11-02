// Migration: Créer la table devoir_quiz_generation pour tracker les générations de quiz

module.exports = {
  up: async (pool) => {
    console.log('Migration 008: Création de la table devoir_quiz_generation');

    const connection = await pool.getConnection();
    try {
      // Créer la table devoir_quiz_generation
      await connection.query(`
        CREATE TABLE IF NOT EXISTS devoir_quiz_generation (
          id INT AUTO_INCREMENT PRIMARY KEY,
          devoir_id INT NOT NULL,
          user_id INT NOT NULL,
          status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
          error_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL,
          FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE KEY unique_devoir_generation (devoir_id)
        )
      `);
      console.log('  ✓ Table devoir_quiz_generation créée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 008 (rollback): Suppression de la table devoir_quiz_generation');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS devoir_quiz_generation');
      console.log('  ✓ Table devoir_quiz_generation supprimée');
    } finally {
      connection.release();
    }
  }
};
