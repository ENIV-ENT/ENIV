const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const MigrationManager = require('../migrations/migrationManager');

// Configuration de la connexion MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'ent',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "utc",
});

// Tester la connexion
pool.getConnection()
  .then(connection => {
    console.log('Connexion à MySQL établie avec succès');
    connection.release();
  })
  .catch(err => {
    console.error('Erreur de connexion à la base de données:', err);
    process.exit(1);
  });

// Créer les tables de base
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

    // Exécuter les migrations
    const migrationManager = new MigrationManager(pool);
    await migrationManager.runMigrations();

    // Créer un superadmin par défaut si aucun n'existe
    const [rows] = await connection.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['superadmin']);
    if (rows[0].count === 0) {
      const hashedPassword = bcrypt.hashSync('superadmin123', 10);
      await connection.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['superadmin', hashedPassword, 'superadmin']);
      console.log('Superadmin par défaut créé: username=superadmin, password=superadmin123');
    }
  } catch (error) {
    console.error('Erreur lors de l\'initialisation de la base de données:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// Initialiser la base de données au démarrage
initDatabase().catch(err => {
  console.error('Erreur fatale lors de l\'initialisation:', err);
  process.exit(1);
});

module.exports = pool;
