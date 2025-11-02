// Migration: Ajouter les actions upload_pdf et delete_pdf à la table devoir_logs

module.exports = {
  up: async (pool) => {
    console.log('Migration 006: Ajout des actions PDF aux logs');

    const connection = await pool.getConnection();
    try {
      // Modifier l'ENUM pour ajouter les nouvelles actions
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete', 'upload_pdf', 'delete_pdf') NOT NULL
      `);
      console.log('  ✓ Actions upload_pdf et delete_pdf ajoutées');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 006 (rollback): Suppression des actions PDF des logs');
    const connection = await pool.getConnection();
    try {
      // Remettre l'ENUM d'origine
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN action ENUM('create', 'update', 'delete') NOT NULL
      `);
      console.log('  ✓ Actions upload_pdf et delete_pdf supprimées');
    } finally {
      connection.release();
    }
  }
};
