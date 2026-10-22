/**
 * Adds the calendar subscription token (iCal export).
 * The token is the only protection of the /api/calendar/<token>.ics feed, which
 * calendar apps fetch without being logged in. It is stored in clear so the student
 * can copy their link at any time; it only gives read access to the assignments and
 * can be regenerated in one click. Binary collation: a base64url token must only
 * match exactly, case included.
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 018: add users.calendar_token');

    const connection = await pool.getConnection();
    try {
      const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE 'calendar_token'");
      if (columns.length === 0) {
        await connection.query('ALTER TABLE users ADD COLUMN calendar_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE');
        console.log('  ✓ Column calendar_token added');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 018 (rollback): drop users.calendar_token');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN calendar_token');
    } finally {
      connection.release();
    }
  }
};
