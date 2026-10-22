/**
 * Adds classes.premium. A premium class unlocks quiz generation (free Groq engine)
 * for all its members. A premium user (users.premium) can always generate with
 * Claude, regardless of this class setting.
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 014: add premium to classes');

    const connection = await pool.getConnection();
    try {
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM classes");
      const columns = tableInfo.map(col => col.Field);

      if (!columns.includes('premium')) {
        await connection.query('ALTER TABLE classes ADD COLUMN premium BOOLEAN DEFAULT FALSE');
        console.log('  ✓ Column premium added');
      } else {
        console.log('  - Column premium already exists');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 014 (rollback): drop premium from classes');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE classes DROP COLUMN premium');
      console.log('  ✓ Column premium dropped');
    } finally {
      connection.release();
    }
  }
};
