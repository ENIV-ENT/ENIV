const fs = require('fs');
const path = require('path');

class MigrationManager {
  constructor(db) {
    this.db = db;
    this.migrationsPath = __dirname;
  }

  // Créer la table de suivi des migrations
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

  // Récupérer toutes les migrations déjà exécutées
  async getExecutedMigrations() {
    const connection = await this.db.getConnection();
    try {
      const [migrations] = await connection.query('SELECT name FROM migrations ORDER BY name');
      return migrations.map(m => m.name);
    } finally {
      connection.release();
    }
  }

  // Récupérer tous les fichiers de migration disponibles
  getAvailableMigrations() {
    const files = fs.readdirSync(this.migrationsPath);
    return files
      .filter(file => file.endsWith('.js') && file !== 'migrationManager.js')
      .sort();
  }

  // Exécuter les migrations en attente
  async runMigrations() {
    await this.initMigrationsTable();

    const executed = await this.getExecutedMigrations();
    const available = this.getAvailableMigrations();

    const pending = available.filter(migration => !executed.includes(migration));

    if (pending.length === 0) {
      console.log('✓ Aucune migration en attente');
      return;
    }

    console.log(`\n=== Exécution de ${pending.length} migration(s) ===\n`);

    for (const migrationFile of pending) {
      const connection = await this.db.getConnection();
      try {
        console.log(`→ Migration: ${migrationFile}`);

        const migrationPath = path.join(this.migrationsPath, migrationFile);
        const migration = require(migrationPath);

        // Exécuter la migration dans une transaction
        await connection.beginTransaction();

        // Passer le pool à la migration
        await migration.up(this.db);

        // Enregistrer la migration comme exécutée
        await connection.query('INSERT INTO migrations (name) VALUES (?)', [migrationFile]);

        await connection.commit();

        console.log(`✓ Migration ${migrationFile} terminée\n`);
      } catch (error) {
        await connection.rollback();
        console.error(`✗ Erreur lors de la migration ${migrationFile}:`, error.message);
        throw error;
      } finally {
        connection.release();
      }
    }

    console.log('=== Migrations terminées ===\n');
  }

  // Revenir en arrière d'une migration (rollback)
  async rollback(migrationName) {
    const executed = await this.getExecutedMigrations();

    if (!executed.includes(migrationName)) {
      console.log(`Migration ${migrationName} n'a pas été exécutée`);
      return;
    }

    const connection = await this.db.getConnection();
    try {
      console.log(`\n→ Rollback: ${migrationName}`);

      const migrationPath = path.join(this.migrationsPath, migrationName);
      const migration = require(migrationPath);

      // Exécuter le rollback dans une transaction
      await connection.beginTransaction();

      if (migration.down) {
        await migration.down(this.db);
      }

      // Supprimer l'enregistrement de la migration
      await connection.query('DELETE FROM migrations WHERE name = ?', [migrationName]);

      await connection.commit();

      console.log(`✓ Rollback ${migrationName} terminé\n`);
    } catch (error) {
      await connection.rollback();
      console.error(`✗ Erreur lors du rollback ${migrationName}:`, error.message);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Afficher le statut des migrations
  async status() {
    const executed = await this.getExecutedMigrations();
    const available = this.getAvailableMigrations();

    console.log('\n=== Statut des migrations ===\n');

    available.forEach(migration => {
      const status = executed.includes(migration) ? '✓ Exécutée' : '○ En attente';
      console.log(`${status} - ${migration}`);
    });

    console.log(`\nTotal: ${available.length} migration(s), ${executed.length} exécutée(s), ${available.length - executed.length} en attente\n`);
  }
}

module.exports = MigrationManager;
