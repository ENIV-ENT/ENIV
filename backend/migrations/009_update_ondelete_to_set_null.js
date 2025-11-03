// Migration: Modifier les contraintes ON DELETE pour utiliser SET NULL au lieu de CASCADE
// pour préserver l'historique lors de la suppression d'utilisateurs

module.exports = {
  up: async (pool) => {
    console.log('Migration 009: Modification des contraintes ON DELETE vers SET NULL');

    const connection = await pool.getConnection();
    try {
      // 1. Modifier devoirs.created_by
      console.log('  - Modification de devoirs.created_by...');

      // Vérifier si la contrainte existe déjà
      const [constraints] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'devoirs'
        AND COLUMN_NAME = 'created_by'
        AND CONSTRAINT_NAME != 'PRIMARY'
      `);

      if (constraints.length > 0) {
        const constraintName = constraints[0].CONSTRAINT_NAME;
        await connection.query(`ALTER TABLE devoirs DROP FOREIGN KEY ${constraintName}`);
        console.log(`    ✓ Contrainte ${constraintName} supprimée`);
      }

      // Modifier la colonne pour accepter NULL
      await connection.query(`
        ALTER TABLE devoirs
        MODIFY COLUMN created_by INT NULL
      `);
      console.log('    ✓ Colonne created_by modifiée pour accepter NULL');

      // Ajouter la nouvelle contrainte avec ON DELETE SET NULL
      await connection.query(`
        ALTER TABLE devoirs
        ADD CONSTRAINT fk_devoirs_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('    ✓ Nouvelle contrainte avec SET NULL ajoutée');

      // 2. Modifier devoir_logs.user_id
      console.log('  - Modification de devoir_logs.user_id...');

      const [logsConstraints] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'devoir_logs'
        AND COLUMN_NAME = 'user_id'
        AND CONSTRAINT_NAME != 'PRIMARY'
      `);

      if (logsConstraints.length > 0) {
        const constraintName = logsConstraints[0].CONSTRAINT_NAME;
        await connection.query(`ALTER TABLE devoir_logs DROP FOREIGN KEY ${constraintName}`);
        console.log(`    ✓ Contrainte ${constraintName} supprimée`);
      }

      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN user_id INT NULL
      `);
      console.log('    ✓ Colonne user_id modifiée pour accepter NULL');

      await connection.query(`
        ALTER TABLE devoir_logs
        ADD CONSTRAINT fk_devoir_logs_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('    ✓ Nouvelle contrainte avec SET NULL ajoutée');

      // 3. Modifier invitations.created_by
      console.log('  - Modification de invitations.created_by...');

      const [invitationsConstraints] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'invitations'
        AND COLUMN_NAME = 'created_by'
        AND CONSTRAINT_NAME != 'PRIMARY'
      `);

      if (invitationsConstraints.length > 0) {
        const constraintName = invitationsConstraints[0].CONSTRAINT_NAME;
        await connection.query(`ALTER TABLE invitations DROP FOREIGN KEY ${constraintName}`);
        console.log(`    ✓ Contrainte ${constraintName} supprimée`);
      }

      await connection.query(`
        ALTER TABLE invitations
        MODIFY COLUMN created_by INT NULL
      `);
      console.log('    ✓ Colonne created_by modifiée pour accepter NULL');

      await connection.query(`
        ALTER TABLE invitations
        ADD CONSTRAINT fk_invitations_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('    ✓ Nouvelle contrainte avec SET NULL ajoutée');

      // 4. Modifier devoir_quiz_generation.user_id
      console.log('  - Modification de devoir_quiz_generation.user_id...');

      const [quizConstraints] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'devoir_quiz_generation'
        AND COLUMN_NAME = 'user_id'
        AND CONSTRAINT_NAME != 'PRIMARY'
      `);

      if (quizConstraints.length > 0) {
        const constraintName = quizConstraints[0].CONSTRAINT_NAME;
        await connection.query(`ALTER TABLE devoir_quiz_generation DROP FOREIGN KEY ${constraintName}`);
        console.log(`    ✓ Contrainte ${constraintName} supprimée`);
      }

      await connection.query(`
        ALTER TABLE devoir_quiz_generation
        MODIFY COLUMN user_id INT NULL
      `);
      console.log('    ✓ Colonne user_id modifiée pour accepter NULL');

      await connection.query(`
        ALTER TABLE devoir_quiz_generation
        ADD CONSTRAINT fk_devoir_quiz_generation_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('    ✓ Nouvelle contrainte avec SET NULL ajoutée');

      console.log('✓ Migration 009 terminée avec succès');
    } catch (error) {
      console.error('Erreur lors de la migration 009:', error);
      throw error;
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 009 (rollback): Restauration des contraintes ON DELETE CASCADE');

    const connection = await pool.getConnection();
    try {
      // Rollback 1: devoirs.created_by
      await connection.query('ALTER TABLE devoirs DROP FOREIGN KEY fk_devoirs_created_by');
      await connection.query(`
        ALTER TABLE devoirs
        MODIFY COLUMN created_by INT NOT NULL
      `);
      await connection.query(`
        ALTER TABLE devoirs
        ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('  ✓ devoirs.created_by restauré');

      // Rollback 2: devoir_logs.user_id
      await connection.query('ALTER TABLE devoir_logs DROP FOREIGN KEY fk_devoir_logs_user_id');
      await connection.query(`
        ALTER TABLE devoir_logs
        MODIFY COLUMN user_id INT NOT NULL
      `);
      await connection.query(`
        ALTER TABLE devoir_logs
        ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('  ✓ devoir_logs.user_id restauré');

      // Rollback 3: invitations.created_by
      await connection.query('ALTER TABLE invitations DROP FOREIGN KEY fk_invitations_created_by');
      await connection.query(`
        ALTER TABLE invitations
        MODIFY COLUMN created_by INT NOT NULL
      `);
      await connection.query(`
        ALTER TABLE invitations
        ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('  ✓ invitations.created_by restauré');

      // Rollback 4: devoir_quiz_generation.user_id
      await connection.query('ALTER TABLE devoir_quiz_generation DROP FOREIGN KEY fk_devoir_quiz_generation_user_id');
      await connection.query(`
        ALTER TABLE devoir_quiz_generation
        MODIFY COLUMN user_id INT NOT NULL
      `);
      await connection.query(`
        ALTER TABLE devoir_quiz_generation
        ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('  ✓ devoir_quiz_generation.user_id restauré');

      console.log('✓ Rollback migration 009 terminé');
    } finally {
      connection.release();
    }
  }
};
