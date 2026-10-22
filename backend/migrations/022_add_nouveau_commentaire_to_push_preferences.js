/**
 * Adds the nouveau_commentaire push preference (a comment posted on an assignment
 * of the class):
 * - tous: every comment on an assignment of the class
 * - participe: only the assignments the student already commented on
 * - aucun: never
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 022: add the nouveau_commentaire push preference');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE push_preferences
        ADD COLUMN nouveau_commentaire ENUM('tous', 'participe', 'aucun') NOT NULL DEFAULT 'participe' AFTER rappel_veille
      `);
      console.log('  ✓ Column nouveau_commentaire added');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 022 (rollback): drop the nouveau_commentaire push preference');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE push_preferences DROP COLUMN nouveau_commentaire');
      console.log('  ✓ Column nouveau_commentaire dropped');
    } finally {
      connection.release();
    }
  }
};
