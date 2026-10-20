// Migration: Créer la table emploi_temps_ics (lien ICS d'une classe et dernière
// version récupérée, servie quand la source ne répond pas)

module.exports = {
  up: async (pool) => {
    console.log('Migration 021: Création de la table emploi_temps_ics');

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

      console.log('  ✓ Table emploi_temps_ics créée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 021 (rollback): Suppression de la table emploi_temps_ics');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS emploi_temps_ics');
      console.log('  ✓ Table emploi_temps_ics supprimée');
    } finally {
      connection.release();
    }
  }
};
