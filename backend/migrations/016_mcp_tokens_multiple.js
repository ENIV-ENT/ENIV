// Migration: Plusieurs jetons MCP par utilisateur, avec un nom et une date d'expiration optionnelle

module.exports = {
  up: async (pool) => {
    console.log('Migration 016: Plusieurs jetons MCP par utilisateur');

    const connection = await pool.getConnection();
    try {
      const [columns] = await connection.query('SHOW COLUMNS FROM mcp_tokens');
      const names = columns.map(col => col.Field);

      if (!names.includes('nom')) {
        await connection.query("ALTER TABLE mcp_tokens ADD COLUMN nom VARCHAR(100) NOT NULL DEFAULT 'Lien MCP' AFTER user_id");
        console.log('  ✓ Colonne nom ajoutée');
      }
      if (!names.includes('expires_at')) {
        await connection.query('ALTER TABLE mcp_tokens ADD COLUMN expires_at TIMESTAMP NULL');
        console.log('  ✓ Colonne expires_at ajoutée');
      }

      // L'index unique sur user_id sert aussi à la clé étrangère : en créer un simple avant de le retirer
      const [indexes] = await connection.query("SHOW INDEX FROM mcp_tokens WHERE Column_name = 'user_id'");
      const indexNames = [...new Set(indexes.map(i => i.Key_name))];
      if (!indexNames.includes('idx_mcp_tokens_user')) {
        await connection.query('ALTER TABLE mcp_tokens ADD INDEX idx_mcp_tokens_user (user_id)');
      }
      for (const index of indexes) {
        if (index.Key_name !== 'idx_mcp_tokens_user' && index.Non_unique === 0) {
          await connection.query(`ALTER TABLE mcp_tokens DROP INDEX \`${index.Key_name}\``);
          console.log(`  ✓ Index unique ${index.Key_name} retiré`);
        }
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 016 (rollback): un seul jeton MCP par utilisateur');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE mcp_tokens ADD UNIQUE INDEX user_id (user_id)');
      await connection.query('ALTER TABLE mcp_tokens DROP INDEX idx_mcp_tokens_user');
      await connection.query('ALTER TABLE mcp_tokens DROP COLUMN expires_at, DROP COLUMN nom');
    } finally {
      connection.release();
    }
  }
};
