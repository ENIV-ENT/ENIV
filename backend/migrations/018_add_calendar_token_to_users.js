// Migration: Jeton d'abonnement à l'agenda (export iCal)
// Le jeton est la seule protection du flux /api/calendar/<jeton>.ics, que les
// applications d'agenda interrogent sans être connectées. Il est conservé en
// clair pour que l'élève puisse recopier son lien à tout moment ; il ne donne
// qu'un accès en lecture aux devoirs, et se régénère d'un clic.
// Collation binaire : un jeton base64url ne doit correspondre qu'à l'identique,
// casse comprise.

module.exports = {
  up: async (pool) => {
    console.log('Migration 018: Ajout de users.calendar_token');

    const connection = await pool.getConnection();
    try {
      const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE 'calendar_token'");
      if (columns.length === 0) {
        await connection.query('ALTER TABLE users ADD COLUMN calendar_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE');
        console.log('  ✓ Colonne calendar_token ajoutée');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 018 (rollback): Suppression de users.calendar_token');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN calendar_token');
    } finally {
      connection.release();
    }
  }
};
