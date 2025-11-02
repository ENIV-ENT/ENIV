// Migration: Créer la table pour lier les devoirs aux quiz

module.exports = {
  up: async (pool) => {
    console.log('Migration 004: Création de la table devoir_quiz');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS devoir_quiz (
          id INT AUTO_INCREMENT PRIMARY KEY,
          devoir_id INT NOT NULL,
          questions_json JSON NOT NULL,
          mode ENUM('choice', 'oral', 'both') DEFAULT 'both',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE,
          UNIQUE KEY unique_devoir_quiz (devoir_id)
        )
      `);
      console.log('  ✓ Table devoir_quiz créée');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS quiz_results (
          id INT AUTO_INCREMENT PRIMARY KEY,
          devoir_quiz_id INT NOT NULL,
          user_id INT NOT NULL,
          score INT NOT NULL,
          total_questions INT NOT NULL,
          correct_answers INT NOT NULL,
          incorrect_answers INT NOT NULL,
          mode ENUM('choice', 'oral') NOT NULL,
          completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (devoir_quiz_id) REFERENCES devoir_quiz(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_user_quiz (user_id, devoir_quiz_id)
        )
      `);
      console.log('  ✓ Table quiz_results créée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 004 (rollback): Suppression des tables quiz');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS quiz_results');
      console.log('  ✓ Table quiz_results supprimée');
      await connection.query('DROP TABLE IF EXISTS devoir_quiz');
      console.log('  ✓ Table devoir_quiz supprimée');
    } finally {
      connection.release();
    }
  }
};
