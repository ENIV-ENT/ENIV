// Migration: Ajouter le champ premium à la table classes
// Une classe premium débloque la génération de quiz (moteur gratuit Groq) pour
// tous ses membres. Un utilisateur premium (users.premium) peut toujours
// générer avec Claude, indépendamment de ce réglage de classe.

module.exports = {
  up: async (pool) => {
    console.log('Migration 014: Ajout du champ premium à la table classes');

    const connection = await pool.getConnection();
    try {
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM classes");
      const columns = tableInfo.map(col => col.Field);

      if (!columns.includes('premium')) {
        await connection.query('ALTER TABLE classes ADD COLUMN premium BOOLEAN DEFAULT FALSE');
        console.log('  ✓ Colonne premium ajoutée');
      } else {
        console.log('  - Colonne premium déjà existante');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 014 (rollback): Suppression du champ premium de classes');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE classes DROP COLUMN premium');
      console.log('  ✓ Colonne premium supprimée');
    } finally {
      connection.release();
    }
  }
};
