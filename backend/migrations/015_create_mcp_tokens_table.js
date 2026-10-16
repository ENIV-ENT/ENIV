// Migration: Créer la table des jetons MCP
// Un jeton MCP permet à un assistant IA (Claude, ChatGPT...) d'accéder aux devoirs
// d'un utilisateur via /api/mcp. Un seul jeton par utilisateur, révocable à tout
// moment depuis les paramètres ; seule son empreinte SHA-256 est stockée.

module.exports = {
  up: async (pool) => {
    console.log('Migration 015: Création de la table mcp_tokens');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS mcp_tokens (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          token_hash CHAR(64) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_used_at TIMESTAMP NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      console.log('  ✓ Table mcp_tokens créée');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 015 (rollback): Suppression de la table mcp_tokens');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS mcp_tokens');
      console.log('  ✓ Table mcp_tokens supprimée');
    } finally {
      connection.release();
    }
  }
};
