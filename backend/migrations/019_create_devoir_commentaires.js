// Migration: Commentaires sous les devoirs
// Les élèves d'une classe peuvent poser une question ou préciser un devoir
// (« c'est l'exercice 3 ou 4 ? »). Un commentaire disparaît avec son devoir ou
// avec le compte de son auteur.

module.exports = {
  up: async (pool) => {
    console.log('Migration 019: Création de la table devoir_commentaires');

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
      console.log('  ✓ Table devoir_commentaires créée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 019 (rollback): Suppression de la table devoir_commentaires');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS devoir_commentaires');
    } finally {
      connection.release();
    }
  }
};
