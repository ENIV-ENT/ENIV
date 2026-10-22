/**
 * Creates emploi_temps_ics: the ICS link of a class and the last fetched version,
 * served when the source does not answer.
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 021: create table emploi_temps_ics');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS emploi_temps_ics (
          classe_id INT PRIMARY KEY,
          url TEXT NOT NULL,
          evenements LONGTEXT NULL,
          fetched_at DATETIME NULL,
          last_attempt_at DATETIME NULL,
          last_error VARCHAR(255) NULL,
          FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
        )
      `);

      console.log('  ✓ Table emploi_temps_ics created');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 021 (rollback): drop table emploi_temps_ics');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS emploi_temps_ics');
      console.log('  ✓ Table emploi_temps_ics dropped');
    } finally {
      connection.release();
    }
  }
};
