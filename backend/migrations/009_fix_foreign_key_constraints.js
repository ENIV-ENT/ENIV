// Migration: Corriger les contraintes de clés étrangères pour gérer les suppressions

module.exports = {
  up: async (pool) => {
    console.log('Migration 009: Correction des contraintes de clés étrangères');

    const connection = await pool.getConnection();
    try {
      // 1. Modifier la contrainte created_by dans devoirs pour SET NULL
      console.log('  - Modification de la contrainte created_by dans devoirs...');

      // Récupérer le nom de la contrainte existante
      const [fkDevoirs] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'devoirs'
          AND COLUMN_NAME = 'created_by'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      if (fkDevoirs.length > 0) {
        const constraintName = fkDevoirs[0].CONSTRAINT_NAME;

        // Supprimer l'ancienne contrainte
        await connection.query(`
          ALTER TABLE devoirs
          DROP FOREIGN KEY ${constraintName}
        `);
        console.log(`    ✓ Ancienne contrainte ${constraintName} supprimée`);
      }

      // Rendre la colonne created_by nullable
      await connection.query(`
        ALTER TABLE devoirs
        MODIFY COLUMN created_by INT NULL
      `);
      console.log('    ✓ Colonne created_by rendue nullable');

      // Ajouter la nouvelle contrainte avec ON DELETE SET NULL
      await connection.query(`
        ALTER TABLE devoirs
        ADD CONSTRAINT fk_devoirs_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
      `);
      console.log('    ✓ Nouvelle contrainte avec SET NULL ajoutée');

      // 2. Modifier la contrainte created_by dans invitations pour SET NULL
      console.log('  - Modification de la contrainte created_by dans invitations...');

      const [fkInvitations] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'invitations'
          AND COLUMN_NAME = 'created_by'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      if (fkInvitations.length > 0) {
        const constraintName = fkInvitations[0].CONSTRAINT_NAME;

        await connection.query(`
          ALTER TABLE invitations
          DROP FOREIGN KEY ${constraintName}
        `);
        console.log(`    ✓ Ancienne contrainte ${constraintName} supprimée`);
      }

      // Rendre la colonne created_by nullable
      await connection.query(`
        ALTER TABLE invitations
        MODIFY COLUMN created_by INT NULL
      `);
      console.log('    ✓ Colonne created_by rendue nullable');

      // Ajouter la nouvelle contrainte avec ON DELETE SET NULL
      await connection.query(`
        ALTER TABLE invitations
        ADD CONSTRAINT fk_invitations_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
      `);
      console.log('    ✓ Nouvelle contrainte avec SET NULL ajoutée');

      // 3. Vérifier et corriger la contrainte uploaded_by dans devoir_fichiers si nécessaire
      console.log('  - Vérification de la contrainte uploaded_by dans devoir_fichiers...');

      const [fkFichiers] = await connection.query(`
        SELECT CONSTRAINT_NAME, DELETE_RULE
        FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'devoir_fichiers'
          AND CONSTRAINT_NAME LIKE '%uploaded_by%'
      `);

      if (fkFichiers.length > 0 && fkFichiers[0].DELETE_RULE !== 'SET NULL') {
        const constraintName = fkFichiers[0].CONSTRAINT_NAME;

        await connection.query(`
          ALTER TABLE devoir_fichiers
          DROP FOREIGN KEY ${constraintName}
        `);

        await connection.query(`
          ALTER TABLE devoir_fichiers
          ADD CONSTRAINT fk_devoir_fichiers_uploaded_by
          FOREIGN KEY (uploaded_by) REFERENCES users(id)
          ON DELETE SET NULL
        `);
        console.log('    ✓ Contrainte uploaded_by mise à jour avec SET NULL');
      } else {
        console.log('    - Contrainte uploaded_by déjà correcte');
      }

      // 4. Vérifier que les contraintes CASCADE sont bien en place
      console.log('  - Vérification des contraintes CASCADE...');

      const cascadeTables = [
        { table: 'devoir_fichiers', column: 'devoir_id', referenced: 'devoirs' },
        { table: 'devoir_statuts', column: 'devoir_id', referenced: 'devoirs' },
        { table: 'devoir_statuts', column: 'user_id', referenced: 'users' },
      ];

      for (const { table, column, referenced } of cascadeTables) {
        const [fk] = await connection.query(`
          SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
          FROM information_schema.REFERENTIAL_CONSTRAINTS rc
          JOIN information_schema.KEY_COLUMN_USAGE kcu
            ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
            AND kcu.TABLE_NAME = ?
            AND kcu.COLUMN_NAME = ?
            AND kcu.REFERENCED_TABLE_NAME = ?
        `, [table, column, referenced]);

        if (fk.length > 0 && fk[0].DELETE_RULE !== 'CASCADE') {
          const constraintName = fk[0].CONSTRAINT_NAME;

          await connection.query(`
            ALTER TABLE ${table}
            DROP FOREIGN KEY ${constraintName}
          `);

          await connection.query(`
            ALTER TABLE ${table}
            ADD CONSTRAINT fk_${table}_${column}
            FOREIGN KEY (${column}) REFERENCES ${referenced}(id)
            ON DELETE CASCADE
          `);
          console.log(`    ✓ Contrainte ${table}.${column} mise à jour avec CASCADE`);
        }
      }

      console.log('✓ Migration 009 terminée avec succès');
    } catch (error) {
      console.error('Erreur lors de la migration 009:', error);
      throw error;
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 009 (rollback): Restauration des anciennes contraintes');
    const connection = await pool.getConnection();
    try {
      // Remettre created_by comme NOT NULL et contrainte sans SET NULL

      // Pour devoirs
      await connection.query(`
        ALTER TABLE devoirs
        DROP FOREIGN KEY fk_devoirs_created_by
      `);

      await connection.query(`
        ALTER TABLE devoirs
        MODIFY COLUMN created_by INT NOT NULL
      `);

      await connection.query(`
        ALTER TABLE devoirs
        ADD FOREIGN KEY (created_by) REFERENCES users(id)
      `);
      console.log('  ✓ Contrainte devoirs.created_by restaurée');

      // Pour invitations
      await connection.query(`
        ALTER TABLE invitations
        DROP FOREIGN KEY fk_invitations_created_by
      `);

      await connection.query(`
        ALTER TABLE invitations
        MODIFY COLUMN created_by INT NOT NULL
      `);

      await connection.query(`
        ALTER TABLE invitations
        ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('  ✓ Contrainte invitations.created_by restaurée');

      console.log('✓ Rollback migration 009 terminé');
    } catch (error) {
      console.error('Erreur lors du rollback de la migration 009:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
};
