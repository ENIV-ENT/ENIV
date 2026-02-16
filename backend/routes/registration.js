const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const { sendJoinRequestEmail } = require('../services/email');
const router = express.Router();

const SEARCH_LIMIT = 10;
const API_LIMIT = 20;

async function searchCachedEtablissements(query) {
  return db.all(
    'SELECT * FROM etablissements WHERE nom LIKE ? OR commune LIKE ? OR uai LIKE ? LIMIT ?',
    [`%${query}%`, `%${query}%`, `%${query}%`, SEARCH_LIMIT]
  );
}

async function cacheEtablissement(record) {
  const { identifiant_de_l_etablissement: uai, nom_etablissement: nom, nom_commune: commune, code_postal: codePostal, latitude, longitude } = record;

  if (!uai || !nom) return null;

  await db.run(
    `INSERT INTO etablissements (uai, nom, commune, code_postal, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nom = VALUES(nom), commune = VALUES(commune), code_postal = VALUES(code_postal), latitude = VALUES(latitude), longitude = VALUES(longitude)`,
    [uai, nom, commune, codePostal, latitude, longitude]
  ).catch(() => { /* ignore cache write errors */ });

  const etab = await db.get('SELECT id FROM etablissements WHERE uai = ?', [uai]);

  return {
    id: etab ? etab.id : null,
    uai,
    nom,
    commune,
    code_postal: codePostal,
    latitude,
    longitude
  };
}

// Recherche d'etablissements via l'API Education Nationale
router.get('/etablissements', async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 3) {
    return res.json([]);
  }

  try {
    const encodedQuery = encodeURIComponent(q);
    const apiUrl = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records?where=search(nom_etablissement,"${encodedQuery}")&limit=${API_LIMIT}&select=identifiant_de_l_etablissement,nom_etablissement,nom_commune,code_postal,latitude,longitude`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return res.json(await searchCachedEtablissements(q));
    }

    const results = await Promise.all(data.results.map(cacheEtablissement));
    return res.json(results.filter(Boolean));
  } catch (error) {
    console.error('Erreur recherche etablissements:', error);
    const cached = await searchCachedEtablissements(q).catch(() => []);
    return res.json(cached);
  }
});

// Lister les classes d'un etablissement
router.get('/classes', async (req, res) => {
  const { etablissement_id } = req.query;

  if (!etablissement_id) {
    return res.json([]);
  }

  try {
    const classes = await db.all(
      `SELECT c.id, c.nom,
        (SELECT COUNT(*) FROM users u WHERE u.classe_id = c.id AND u.role = 'eleve') as nb_eleves,
        (SELECT u.username FROM users u WHERE u.id = c.admin_id) as admin_username
       FROM classes c
       WHERE c.etablissement_id = ?
       ORDER BY c.nom`,
      [etablissement_id]
    );
    res.json(classes);
  } catch (error) {
    console.error('Erreur listing classes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function notifyClassAdmin(classe, prenom, nom, classeId) {
  if (!classe.admin_id) return;

  const admin = await db.get('SELECT email FROM users WHERE id = ?', [classe.admin_id]);
  const classeInfo = await db.get('SELECT nom FROM classes WHERE id = ?', [classeId]);

  if (admin && admin.email) {
    await sendJoinRequestEmail(admin.email, `${prenom} ${nom}`, classeInfo.nom);
  }
}

async function createUserWithJoinRequest(fields) {
  const { username, hashedPassword, email, nom, prenom, classe_id, etablissement_id } = fields;

  const classe = await db.get(
    'SELECT id, admin_id FROM classes WHERE id = ? AND etablissement_id = ?',
    [classe_id, etablissement_id]
  );
  if (!classe) {
    return { status: 400, body: { error: 'Classe introuvable' } };
  }

  const result = await db.run(
    'INSERT INTO users (username, password, email, nom, prenom, role) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, email || null, nom, prenom, 'eleve']
  );

  await db.run(
    'INSERT INTO join_requests (user_id, classe_id) VALUES (?, ?)',
    [result.lastInsertRowid, classe_id]
  );

  await notifyClassAdmin(classe, prenom, nom, classe_id).catch(err => {
    console.error('Erreur envoi email notification:', err);
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Compte cree ! Votre demande d\'adhesion a ete envoyee a l\'administrateur de la classe.',
      pending: true
    }
  };
}

async function createUserWithNewClasse(fields) {
  const { username, hashedPassword, email, nom, prenom, classe_nom, etablissement_id } = fields;

  const result = await db.run(
    'INSERT INTO users (username, password, email, nom, prenom, role) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, email || null, nom, prenom, 'admin']
  );

  const userId = result.lastInsertRowid;

  const classeResult = await db.run(
    'INSERT INTO classes (nom, etablissement_id, admin_id) VALUES (?, ?, ?)',
    [classe_nom, etablissement_id, userId]
  );

  await db.run('UPDATE users SET classe_id = ? WHERE id = ?', [classeResult.lastInsertRowid, userId]);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Compte et classe crees avec succes ! Vous etes maintenant administrateur de cette classe.',
      pending: false
    }
  };
}

// Inscription d'un nouvel utilisateur
router.post('/register', async (req, res) => {
  const { username, password, email, nom, prenom, etablissement_id, classe_nom, classe_id } = req.body;

  if (!username || !password || !nom || !prenom || !etablissement_id) {
    return res.status(400).json({ error: 'Tous les champs obligatoires doivent etre remplis' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Le nom d\'utilisateur doit contenir au moins 3 caracteres' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caracteres' });
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est deja pris' });
    }

    if (email) {
      const existingEmail = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
      if (existingEmail) {
        return res.status(400).json({ error: 'Cet email est deja utilise' });
      }
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const fields = { username, hashedPassword, email, nom, prenom, etablissement_id, classe_id, classe_nom };

    let outcome;
    if (classe_id) {
      outcome = await createUserWithJoinRequest(fields);
    } else if (classe_nom) {
      outcome = await createUserWithNewClasse(fields);
    } else {
      return res.status(400).json({ error: 'Veuillez selectionner une classe ou en creer une nouvelle' });
    }

    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('Erreur inscription:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur ou cet email est deja utilise' });
    }
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// Verifier la disponibilite d'un username
router.post('/check-username', async (req, res) => {
  const { username } = req.body;

  if (!username || username.length < 3) {
    return res.json({ available: false, message: 'Le nom d\'utilisateur doit contenir au moins 3 caracteres' });
  }

  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existing) {
      return res.json({ available: false, message: 'Ce nom d\'utilisateur est deja pris' });
    }
    return res.json({ available: true, message: 'Nom d\'utilisateur disponible' });
  } catch (error) {
    return res.json({ available: false, message: 'Erreur de verification' });
  }
});

// Recuperer les infos pour un lien pre-rempli
router.get('/invite-info', async (req, res) => {
  const { classe_id, etab_id } = req.query;

  if (!classe_id || !etab_id) {
    return res.status(400).json({ error: 'Parametres manquants' });
  }

  try {
    const classe = await db.get('SELECT c.id, c.nom FROM classes c WHERE c.id = ? AND c.etablissement_id = ?', [classe_id, etab_id]);
    const etab = await db.get('SELECT id, nom, commune, code_postal, latitude, longitude FROM etablissements WHERE id = ?', [etab_id]);

    if (!classe || !etab) {
      return res.status(404).json({ error: 'Classe ou etablissement introuvable' });
    }

    res.json({ classe, etablissement: etab });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
