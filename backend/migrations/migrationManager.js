const fs = require('fs');
const path = require('path');

class MigrationManager {
  constructor(db) {
    this.db = db;
    this.migrationsPath = __dirname;
    this.initMigrationsTable();
  }

  // Créer la table de suivi des migrations
  initMigrationsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Récupérer toutes les migrations déjà exécutées
  getExecutedMigrations() {
    const migrations = this.db.prepare('SELECT name FROM migrations ORDER BY name').all();
    return migrations.map(m => m.name);
  }

  // Récupérer tous les fichiers de migration disponibles
  getAvailableMigrations() {
    const files = fs.readdirSync(this.migrationsPath);
    return files
      .filter(file => file.endsWith('.js') && file !== 'migrationManager.js')
      .sort();
  }

  // Exécuter les migrations en attente
  runMigrations() {
    const executed = this.getExecutedMigrations();
    const available = this.getAvailableMigrations();

    const pending = available.filter(migration => !executed.includes(migration));

    if (pending.length === 0) {
      console.log('✓ Aucune migration en attente');
      return;
    }

    console.log(`\n=== Exécution de ${pending.length} migration(s) ===\n`);

    pending.forEach(migrationFile => {
      try {
        console.log(`→ Migration: ${migrationFile}`);

        const migrationPath = path.join(this.migrationsPath, migrationFile);
        const migration = require(migrationPath);

        // Exécuter la migration dans une transaction
        const transaction = this.db.transaction(() => {
          migration.up(this.db);

          // Enregistrer la migration comme exécutée
          this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationFile);
        });

        transaction();
        console.log(`✓ Migration ${migrationFile} terminée\n`);
      } catch (error) {
        console.error(`✗ Erreur lors de la migration ${migrationFile}:`, error.message);
        throw error;
      }
    });

    console.log('=== Migrations terminées ===\n');
  }

  // Revenir en arrière d'une migration (rollback)
  rollback(migrationName) {
    const executed = this.getExecutedMigrations();

    if (!executed.includes(migrationName)) {
      console.log(`Migration ${migrationName} n'a pas été exécutée`);
      return;
    }

    try {
      console.log(`\n→ Rollback: ${migrationName}`);

      const migrationPath = path.join(this.migrationsPath, migrationName);
      const migration = require(migrationPath);

      // Exécuter le rollback dans une transaction
      const transaction = this.db.transaction(() => {
        if (migration.down) {
          migration.down(this.db);
        }

        // Supprimer l'enregistrement de la migration
        this.db.prepare('DELETE FROM migrations WHERE name = ?').run(migrationName);
      });

      transaction();
      console.log(`✓ Rollback ${migrationName} terminé\n`);
    } catch (error) {
      console.error(`✗ Erreur lors du rollback ${migrationName}:`, error.message);
      throw error;
    }
  }

  // Afficher le statut des migrations
  status() {
    const executed = this.getExecutedMigrations();
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
