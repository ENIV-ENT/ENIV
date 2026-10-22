/**
 * Creates the MCP token table. An MCP token lets an AI assistant (Claude,
 * ChatGPT...) access a user's assignments through /api/mcp. It can be revoked at
 * any time from the settings; only its SHA-256 hash is stored.
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 015: create table mcp_tokens');

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
      console.log('  ✓ Table mcp_tokens created');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 015 (rollback): drop table mcp_tokens');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS mcp_tokens');
      console.log('  ✓ Table mcp_tokens dropped');
    } finally {
      connection.release();
    }
  }
};
