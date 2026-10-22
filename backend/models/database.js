const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const MigrationManager = require('../migrations/migrationManager');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'ent',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z",
});

pool.getConnection()
  .then(connection => {
    console.log('Connected to MySQL');
    connection.release();
  })
  .catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });

/**
 * Creates the base tables, runs the migrations and creates the superadmin account.
 *
 * The superadmin password comes from SUPERADMIN_PASSWORD; otherwise it is drawn at
 * random and printed once in the logs, so there is no password known to everyone.
 * Databases created before that change may still use the old public password
 * superadmin123: it is reported on every startup until it is changed.
 */
async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email VARCHAR(255) UNIQUE,
        nom TEXT,
        prenom TEXT,
        role ENUM('superadmin', 'admin', 'eleve') NOT NULL,
        classe_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS matieres (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom TEXT NOT NULL,
        image TEXT,
        lien TEXT,
        couleur TEXT,
        classe_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS devoirs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        titre TEXT NOT NULL,
        description TEXT,
        matiere_id INT NOT NULL,
        date TIMESTAMP NULL,
        classe_id INT NOT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (matiere_id) REFERENCES matieres(id) ON DELETE CASCADE,
        FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS devoir_statuts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        devoir_id INT NOT NULL,
        user_id INT NOT NULL,
        fait BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_devoir_user (devoir_id, user_id)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS devoir_fichiers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        devoir_id INT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(255) PRIMARY KEY,
        value TEXT,
        classe_id INT,
        FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS invitations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        role ENUM('admin', 'eleve') NOT NULL,
        classe_id INT,
        created_by INT NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    const migrationManager = new MigrationManager(pool);
    await migrationManager.runMigrations();

    const [rows] = await connection.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['superadmin']);
    if (rows[0].count === 0) {
      const fromEnv = process.env.SUPERADMIN_PASSWORD;
      const password = fromEnv || crypto.randomBytes(12).toString('base64url');
      const hashedPassword = bcrypt.hashSync(password, 10);
      await connection.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['superadmin', hashedPassword, 'superadmin']);
      if (fromEnv) {
        console.log('Superadmin created: username=superadmin, password = SUPERADMIN_PASSWORD');
      } else {
        console.log(`Superadmin created: username=superadmin, password=${password} (change it on first login)`);
      }
    }

    const [superadmins] = await connection.query('SELECT username, password FROM users WHERE role = ?', ['superadmin']);
    for (const { username, password } of superadmins) {
      if (await bcrypt.compare('superadmin123', password)) {
        console.warn(`⚠ Superadmin "${username}" still uses the default password superadmin123: change it now.`);
      }
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}

initDatabase().catch(err => {
  console.error('Fatal: initialization failed:', err);
  process.exit(1);
});

module.exports = pool;
