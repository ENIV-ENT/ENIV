// Migration: Ajouter l'action delete_commentaire à la table devoir_logs
// (suppression d'un commentaire, visible dans l'onglet Historique)

module.exports = {
  up: async (pool) => {
    console.log('Migration 020: Ajout de l\'action delete_commentaire aux logs');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete', 'upload_pdf', 'delete_pdf', 'delete_commentaire') NOT NULL
      `);
      console.log('  ✓ Action delete_commentaire ajoutée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 020 (rollback): Suppression de l\'action delete_commentaire des logs');
    const connection = await pool.getConnection();
    try {
      await connection.query("DELETE FROM devoir_logs WHERE action = 'delete_commentaire'");
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete', 'upload_pdf', 'delete_pdf') NOT NULL
      `);
      console.log('  ✓ Action delete_commentaire supprimée');
    } finally {
      connection.release();
    }
  }
};
