/**
 * Creates the Web Push tables:
 * - push_subscriptions: one subscription per browser/device of a user (the endpoint
 *   given by the browser and its two encryption keys), indexed by the SHA-256 of the
 *   endpoint, which can exceed the size of an index key;
 * - push_preferences: what the user wants to receive. No row means the defaults
 *   (everything enabled).
 */
module.exports = {
  up: async (pool) => {
    console.log('Migration 017: create the push notification tables');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          endpoint TEXT NOT NULL,
          -- SHA-256 de l'endpoint : un endpoint peut dépasser la taille d'une clé d'index
          endpoint_hash CHAR(64) NOT NULL UNIQUE,
          p256dh VARCHAR(255) NOT NULL,
          auth VARCHAR(255) NOT NULL,
          user_agent VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_success_at TIMESTAMP NULL,
          INDEX idx_push_subscriptions_user (user_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      console.log('  ✓ Table push_subscriptions created');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS push_preferences (
          user_id INT PRIMARY KEY,
          nouveau_devoir BOOLEAN NOT NULL DEFAULT TRUE,
          devoir_modifie BOOLEAN NOT NULL DEFAULT TRUE,
          rappel_veille BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      console.log('  ✓ Table push_preferences created');
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 017 (rollback): drop the push notification tables');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS push_preferences');
      await connection.query('DROP TABLE IF EXISTS push_subscriptions');
      console.log('  ✓ Tables dropped');
    } finally {
      connection.release();
    }
  }
};
