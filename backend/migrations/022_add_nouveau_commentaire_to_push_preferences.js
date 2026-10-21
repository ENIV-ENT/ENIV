// Migration: Ajouter la préférence nouveau_commentaire à push_preferences
// (notification push quand un commentaire est posté sur un devoir de la classe) :
// - tous : chaque commentaire sur un devoir de la classe
// - participe : seulement les devoirs où l'élève a déjà écrit un commentaire
// - aucun : jamais

module.exports = {
  up: async (pool) => {
    console.log('Migration 022: Ajout de la préférence push nouveau_commentaire');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE push_preferences
        ADD COLUMN nouveau_commentaire ENUM('tous', 'participe', 'aucun') NOT NULL DEFAULT 'participe' AFTER rappel_veille
      `);
      console.log('  ✓ Colonne nouveau_commentaire ajoutée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 022 (rollback): Suppression de la préférence push nouveau_commentaire');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE push_preferences DROP COLUMN nouveau_commentaire');
      console.log('  ✓ Colonne nouveau_commentaire supprimée');
    } finally {
      connection.release();
    }
  }
};
