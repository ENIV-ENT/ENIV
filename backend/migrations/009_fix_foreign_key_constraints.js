module.exports = {
  up: async (pool) => {
    console.log('Migration 009: fix the foreign key constraints');

    const connection = await pool.getConnection();
    try {
      console.log('  - Updating the created_by constraint of devoirs...');

      const [fkAssignments] = await connection.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'devoirs'
          AND COLUMN_NAME = 'created_by'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      if (fkAssignments.length > 0) {
        const constraintName = fkAssignments[0].CONSTRAINT_NAME;

        await connection.query(`
          ALTER TABLE devoirs
          DROP FOREIGN KEY ${constraintName}
        `);
        console.log(`    ✓ Previous constraint ${constraintName} dropped`);
      }

      await connection.query(`
        ALTER TABLE devoirs
        MODIFY COLUMN created_by INT NULL
      `);
      console.log('    ✓ Column created_by made nullable');

      await connection.query(`
        ALTER TABLE devoirs
        ADD CONSTRAINT fk_devoirs_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
      `);
      console.log('    ✓ New constraint with SET NULL added');

      console.log('  - Updating the created_by constraint of invitations...');

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
        console.log(`    ✓ Previous constraint ${constraintName} dropped`);
      }

      await connection.query(`
        ALTER TABLE invitations
        MODIFY COLUMN created_by INT NULL
      `);
      console.log('    ✓ Column created_by made nullable');

      await connection.query(`
        ALTER TABLE invitations
        ADD CONSTRAINT fk_invitations_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
      `);
      console.log('    ✓ New constraint with SET NULL added');

      console.log('  - Checking the uploaded_by constraint of devoir_fichiers...');

      const [fkFiles] = await connection.query(`
        SELECT CONSTRAINT_NAME, DELETE_RULE
        FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'devoir_fichiers'
          AND CONSTRAINT_NAME LIKE '%uploaded_by%'
      `);

      if (fkFiles.length > 0 && fkFiles[0].DELETE_RULE !== 'SET NULL') {
        const constraintName = fkFiles[0].CONSTRAINT_NAME;

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
        console.log('    ✓ Constraint uploaded_by updated with SET NULL');
      } else {
        console.log('    - Constraint uploaded_by already correct');
      }

      console.log('  - Checking the CASCADE constraints...');

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
          console.log(`    ✓ Constraint ${table}.${column} updated with CASCADE`);
        }
      }

      console.log('✓ Migration 009 done');
    } catch (error) {
      console.error('Migration failed: 009:', error);
      throw error;
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 009 (rollback): restore the previous constraints');
    const connection = await pool.getConnection();
    try {

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
      console.log('  ✓ Constraint devoirs.created_by restored');

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
      console.log('  ✓ Constraint invitations.created_by restored');

      console.log('✓ Rollback of migration 009 done');
    } catch (error) {
      console.error('Rollback failed: 009:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
};
