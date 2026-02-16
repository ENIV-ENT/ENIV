// Migration: Système d'inscription - tables etablissements, join_requests, modifications classes

module.exports = {
  up: async (pool) => {
    console.log('Migration 010: Système d\'inscription interactif');

    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS etablissements (
          id INT AUTO_INCREMENT PRIMARY KEY,
          uai VARCHAR(10) UNIQUE,
          nom VARCHAR(255) NOT NULL,
          commune VARCHAR(255),
          code_postal VARCHAR(10),
          latitude DECIMAL(10,8),
          longitude DECIMAL(11,8),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('  + Table etablissements créée');

      await connection.query(`
        CREATE TABLE IF NOT EXISTS join_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          classe_id INT NOT NULL,
          status ENUM('pending','accepted','rejected') DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
        )
      `);
      console.log('  + Table join_requests créée');

      const [classeCols] = await connection.query("SHOW COLUMNS FROM classes");
      const classeColumns = classeCols.map(col => col.Field);

      if (!classeColumns.includes('etablissement_id')) {
        await connection.query(`
          ALTER TABLE classes
          ADD COLUMN etablissement_id INT,
          ADD CONSTRAINT fk_classes_etablissement FOREIGN KEY (etablissement_id) REFERENCES etablissements(id) ON DELETE SET NULL
        `);
        console.log('  + Colonne etablissement_id ajoutée à classes');
      }

      if (!classeColumns.includes('admin_id')) {
        await connection.query(`
          ALTER TABLE classes
          ADD COLUMN admin_id INT,
          ADD CONSTRAINT fk_classes_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
        `);
        console.log('  + Colonne admin_id ajoutée à classes');
      }

      await connection.query(`
        UPDATE classes c
        SET c.admin_id = (
          SELECT u.id FROM users u WHERE u.role = 'admin' AND u.classe_id = c.id LIMIT 1
        )
        WHERE c.admin_id IS NULL
      `);
      console.log('  + admin_id mis à jour pour les classes existantes');

    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 010 (rollback): Suppression du système d\'inscription');
    const connection = await pool.getConnection();
    try {
      await connection.query('DROP TABLE IF EXISTS join_requests');

      // Look up foreign key names dynamically to avoid relying on auto-generated names
      const [fkRows] = await connection.query(`
        SELECT COLUMN_NAME, CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'classes'
          AND COLUMN_NAME IN ('etablissement_id', 'admin_id')
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      for (const { COLUMN_NAME, CONSTRAINT_NAME } of fkRows) {
        await connection.query(`ALTER TABLE classes DROP FOREIGN KEY ${CONSTRAINT_NAME}`);
        await connection.query(`ALTER TABLE classes DROP COLUMN ${COLUMN_NAME}`);
        console.log(`  - Contrainte ${CONSTRAINT_NAME} et colonne ${COLUMN_NAME} supprimées`);
      }

      await connection.query('DROP TABLE IF EXISTS etablissements');
    } catch (error) {
      console.error('Erreur lors du rollback de la migration 010:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
};
