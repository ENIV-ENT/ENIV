const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, '../ent.db'));

// Créer les tables
db.exec(`
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    nom TEXT,
    prenom TEXT,
    role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'eleve')),
    classe_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS matieres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    image TEXT,
    lien TEXT,
    couleur TEXT,
    classe_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS devoirs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    description TEXT,
    matiere_id INTEGER NOT NULL,
    date DATETIME,
    classe_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (matiere_id) REFERENCES matieres(id) ON DELETE CASCADE,
    FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS devoir_statuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    devoir_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    fait BOOLEAN DEFAULT 0,
    FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(devoir_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS devoir_fichiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    devoir_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (devoir_id) REFERENCES devoirs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    classe_id INTEGER,
    FOREIGN KEY (classe_id) REFERENCES classes(id) ON DELETE CASCADE
  );
`);

// Créer un superadmin par défaut si aucun n'existe
const superadminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('superadmin');
if (superadminExists.count === 0) {
  const hashedPassword = bcrypt.hashSync('superadmin123', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('superadmin', hashedPassword, 'superadmin');
  console.log('Superadmin par défaut créé: username=superadmin, password=superadmin123');
}

module.exports = db;
