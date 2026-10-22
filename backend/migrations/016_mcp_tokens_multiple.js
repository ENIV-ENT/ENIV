/**
 * Allows several MCP tokens per user, with a name and an optional expiry date.
 * The unique index on user_id also backs the foreign key: a plain index is created
 * before the unique one is dropped.
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 016: several MCP tokens per user');

    const connection = await pool.getConnection();
    try {
      const [columns] = await connection.query('SHOW COLUMNS FROM mcp_tokens');
      const names = columns.map(col => col.Field);

      if (!names.includes('nom')) {
        await connection.query("ALTER TABLE mcp_tokens ADD COLUMN nom VARCHAR(100) NOT NULL DEFAULT 'Lien MCP' AFTER user_id");
        console.log('  ✓ Column nom added');
      }
      if (!names.includes('expires_at')) {
        await connection.query('ALTER TABLE mcp_tokens ADD COLUMN expires_at TIMESTAMP NULL');
        console.log('  ✓ Column expires_at added');
      }

      const [indexes] = await connection.query("SHOW INDEX FROM mcp_tokens WHERE Column_name = 'user_id'");
      const indexNames = [...new Set(indexes.map(i => i.Key_name))];
      if (!indexNames.includes('idx_mcp_tokens_user')) {
        await connection.query('ALTER TABLE mcp_tokens ADD INDEX idx_mcp_tokens_user (user_id)');
      }
      for (const index of indexes) {
        if (index.Key_name !== 'idx_mcp_tokens_user' && index.Non_unique === 0) {
          await connection.query(`ALTER TABLE mcp_tokens DROP INDEX \`${index.Key_name}\``);
          console.log(`  ✓ Unique index ${index.Key_name} dropped`);
        }
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 016 (rollback): one MCP token per user');
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
