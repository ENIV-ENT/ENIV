module.exports = {
  up: async (pool) => {
    console.log('Migration 001: add email, nom and prenom to users');

    const connection = await pool.getConnection();
    try {
      const [tableInfo] = await connection.query("SHOW COLUMNS FROM users");
      const columns = tableInfo.map(col => col.Field);

      if (!columns.includes('email')) {
        await connection.query('ALTER TABLE users ADD COLUMN email VARCHAR(255)');
        console.log('  ✓ Column email added');
      } else {
        console.log('  - Column email already exists');
      }

      if (!columns.includes('nom')) {
        await connection.query('ALTER TABLE users ADD COLUMN nom VARCHAR(255)');
        console.log('  ✓ Column nom added');
      } else {
        console.log('  - Column nom already exists');
      }

      if (!columns.includes('prenom')) {
        await connection.query('ALTER TABLE users ADD COLUMN prenom VARCHAR(255)');
        console.log('  ✓ Column prenom added');
      } else {
        console.log('  - Column prenom already exists');
      }
    } finally {
      connection.release();
    }
  },

  down: async (pool) => {
    console.log('Migration 001 (rollback): drop email, nom and prenom');
    const connection = await pool.getConnection();
    try {
      await connection.query('ALTER TABLE users DROP COLUMN email');
      await connection.query('ALTER TABLE users DROP COLUMN nom');
      await connection.query('ALTER TABLE users DROP COLUMN prenom');
      console.log('  ✓ Columns dropped');
    } finally {
      connection.release();
    }
  }
};
