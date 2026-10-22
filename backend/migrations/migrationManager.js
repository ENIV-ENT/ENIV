const fs = require('fs');
const path = require('path');

/**
 * Runs the numbered migrations of this folder at startup.
 *
 * Migrations are tracked by file name in the `migrations` table: renaming a
 * migration file makes it run again. Each `up(pool)` receives the pool, not the
 * transaction connection, and MySQL DDL commits implicitly, so a migration that
 * fails halfway is not rolled back: write migrations that can run again safely.
 */
class MigrationManager {
  constructor(db) {
    this.db = db;
    this.migrationsPath = __dirname;
  }

  /** Creates the migration tracking table. */
  async initMigrationsTable() {
    const connection = await this.db.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } finally {
      connection.release();
    }
  }

  /** @returns {Promise<string[]>} file names of the migrations already run */
  async getExecutedMigrations() {
    const connection = await this.db.getConnection();
    try {
      const [migrations] = await connection.query('SELECT name FROM migrations ORDER BY name');
      return migrations.map(m => m.name);
    } finally {
      connection.release();
    }
  }

  /** @returns {string[]} file names of every migration in the folder, sorted */
  getAvailableMigrations() {
    const files = fs.readdirSync(this.migrationsPath);
    return files
      .filter(file => file.endsWith('.js') && file !== 'migrationManager.js')
      .sort();
  }

  /** Runs the pending migrations, in file name order. */
  async runMigrations() {
    await this.initMigrationsTable();

    const executed = await this.getExecutedMigrations();
    const available = this.getAvailableMigrations();

    const pending = available.filter(migration => !executed.includes(migration));

    if (pending.length === 0) {
      console.log('✓ No pending migrations');
      return;
    }

    console.log(`\n=== Running ${pending.length} migration(s) ===\n`);

    for (const migrationFile of pending) {
      const connection = await this.db.getConnection();
      try {
        console.log(`→ Migration: ${migrationFile}`);

        const migrationPath = path.join(this.migrationsPath, migrationFile);
        const migration = require(migrationPath);

        await connection.beginTransaction();

        await migration.up(this.db);

        await connection.query('INSERT INTO migrations (name) VALUES (?)', [migrationFile]);

        await connection.commit();

        console.log(`✓ Migration ${migrationFile} done\n`);
      } catch (error) {
        await connection.rollback();
        console.error(`✗ Migration failed: ${migrationFile}:`, error.message);
        throw error;
      } finally {
        connection.release();
      }
    }

    console.log('=== Migrations completed ===\n');
  }

  /** Reverts one migration with its `down` function, if any. */
  async rollback(migrationName) {
    const executed = await this.getExecutedMigrations();

    if (!executed.includes(migrationName)) {
      console.log(`Migration ${migrationName} has not been run`);
      return;
    }

    const connection = await this.db.getConnection();
    try {
      console.log(`\n→ Rollback: ${migrationName}`);

      const migrationPath = path.join(this.migrationsPath, migrationName);
      const migration = require(migrationPath);

      await connection.beginTransaction();

      if (migration.down) {
        await migration.down(this.db);
      }

      await connection.query('DELETE FROM migrations WHERE name = ?', [migrationName]);

      await connection.commit();

      console.log(`✓ Rollback ${migrationName} done\n`);
    } catch (error) {
      await connection.rollback();
      console.error(`✗ Rollback failed: ${migrationName}:`, error.message);
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Prints which migrations ran and which are pending. */
  async status() {
    const executed = await this.getExecutedMigrations();
    const available = this.getAvailableMigrations();

    console.log('\n=== Migration status ===\n');

    available.forEach(migration => {
      const status = executed.includes(migration) ? '✓ Done' : '○ Pending';
      console.log(`${status} - ${migration}`);
    });

    console.log(`\nTotal: ${available.length} migration(s), ${executed.length} done, ${available.length - executed.length} pending\n`);
  }
}

module.exports = MigrationManager;
