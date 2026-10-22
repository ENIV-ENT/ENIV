const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const { sendJoinRequestEmail, sendSchoolRequestEmail } = require('../services/email');
const { signupLimiter, lookupLimiter } = require('../middleware/rateLimit');
const router = express.Router();

const SEARCH_LIMIT = 10;
const API_LIMIT = 20;

async function searchCachedSchools(query) {
  return db.all(
    'SELECT * FROM etablissements WHERE nom LIKE ? OR commune LIKE ? OR uai LIKE ? LIMIT ?',
    [`%${query}%`, `%${query}%`, `%${query}%`, SEARCH_LIMIT]
  );
}

/**
 * Caches a higher education school returned by the data.gouv API, ignoring cache
 * write errors, and returns it in the shape of the etablissements table.
 */
async function cacheHigherEducationSchool(record) {
  const uai = record.uai;
  const name = record.implantation_lib || record.uo_lib;
  const town = record.com_nom;
  const postalCode = record.code_postal_uai;
  const latitude = record.coordonnees ? record.coordonnees.lat : null;
  const longitude = record.coordonnees ? record.coordonnees.lon : null;

  if (!uai || !name) return null;

  await db.run(
    `INSERT INTO etablissements (uai, nom, commune, code_postal, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nom = VALUES(nom), commune = VALUES(commune), code_postal = VALUES(code_postal), latitude = VALUES(latitude), longitude = VALUES(longitude)`,
    [uai, name, town, postalCode, latitude, longitude]
  ).catch(() => {});

  const school = await db.get('SELECT id FROM etablissements WHERE uai = ?', [uai]);

  return {
    id: school ? school.id : null,
    uai,
    nom: name,
    commune: town,
    code_postal: postalCode,
    latitude,
    longitude
  };
}

/** Searches schools through the French higher education API, with the cache as fallback. */
router.get('/etablissements', async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 3) {
    return res.json([]);
  }

  try {
    const encodedQuery = encodeURIComponent(q);
    const apiUrl = `https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-implantations_etablissements_d_enseignement_superieur_publics/records?where=search(implantation_lib,"${encodedQuery}")&limit=${API_LIMIT}&select=uai,implantation_lib,com_nom,code_postal_uai,coordonnees`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return res.json(await searchCachedSchools(q));
    }

    const results = await Promise.all(data.results.map(cacheHigherEducationSchool));
    return res.json(results.filter(Boolean));
  } catch (error) {
    console.error('School search failed:', error);
    const cached = await searchCachedSchools(q).catch(() => []);
    return res.json(cached);
  }
});

/** Lists the classes of a school. */
router.get('/classes', async (req, res) => {
  const { etablissement_id: schoolId } = req.query;

  if (!schoolId) {
    return res.json([]);
  }

  try {
    const classes = await db.all(
      `SELECT c.id, c.nom,
        (SELECT COUNT(*) FROM users u WHERE u.classe_id = c.id AND u.role = 'eleve') as nb_eleves,
        (SELECT GROUP_CONCAT(u.username SEPARATOR ', ') FROM users u WHERE u.role = 'admin' AND u.classe_id = c.id) as admin_username
       FROM classes c
       WHERE c.etablissement_id = ?
       ORDER BY c.nom`,
      [schoolId]
    );
    res.json(classes);
  } catch (error) {
    console.error('Error listing classes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function notifyClassAdmins(classId, firstName, lastName) {
  const admins = await db.all(
    'SELECT email FROM users WHERE role = ? AND classe_id = ? AND email IS NOT NULL',
    ['admin', classId]
  );

  if (!admins.length) return;

  const schoolClass = await db.get('SELECT nom FROM classes WHERE id = ?', [classId]);

  await Promise.all(
    admins.map(admin => sendJoinRequestEmail(admin.email, `${firstName} ${lastName}`, schoolClass.nom))
  );
}

/** Creates a student account with a join request to an existing class of the school. */
async function createUserWithJoinRequest(fields) {
  const { username, hashedPassword, email, lastName, firstName, classId, schoolId } = fields;

  const schoolClass = await db.get(
    'SELECT id FROM classes WHERE id = ? AND etablissement_id = ?',
    [classId, schoolId]
  );
  if (!schoolClass) {
    return { status: 400, body: { error: 'Classe introuvable' } };
  }

  const result = await db.run(
    'INSERT INTO users (username, password, email, nom, prenom, role) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, email || null, lastName, firstName, 'eleve']
  );

  await db.run(
    'INSERT INTO join_requests (user_id, classe_id) VALUES (?, ?)',
    [result.lastInsertRowid, classId]
  );

  await notifyClassAdmins(classId, firstName, lastName).catch(err => {
    console.error('Failed to send the notification email:', err);
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

/** Creates an admin account with a new class in the school. */
async function createUserWithNewClass(fields) {
  const { username, hashedPassword, email, lastName, firstName, className, schoolId } = fields;

  const result = await db.run(
    'INSERT INTO users (username, password, email, nom, prenom, role) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, email || null, lastName, firstName, 'admin']
  );

  const userId = result.lastInsertRowid;

  const classResult = await db.run(
    'INSERT INTO classes (nom, etablissement_id) VALUES (?, ?)',
    [className, schoolId]
  );

  await db.run('UPDATE users SET classe_id = ? WHERE id = ?', [classResult.lastInsertRowid, userId]);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Compte et classe crees avec succes ! Vous etes maintenant administrateur de cette classe.',
      pending: false
    }
  };
}

/** Signs up a new user, joining an existing class or creating one. */
router.post('/register', signupLimiter, async (req, res) => {
  const {
    username, password, email, nom: lastName, prenom: firstName,
    etablissement_id: schoolId, classe_nom: className, classe_id: classId
  } = req.body || {};

  if (!username || !password || !lastName || !firstName || !schoolId) {
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

    const hashedPassword = await bcrypt.hash(password, 10);
    const fields = { username, hashedPassword, email, lastName, firstName, schoolId, classId, className };

    let outcome;
    if (classId) {
      outcome = await createUserWithJoinRequest(fields);
    } else if (className) {
      outcome = await createUserWithNewClass(fields);
    } else {
      return res.status(400).json({ error: 'Veuillez selectionner une classe ou en creer une nouvelle' });
    }

    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('Signup failed:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur ou cet email est deja utilise' });
    }
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

/** Checks whether a username is available. */
router.post('/check-username', lookupLimiter, async (req, res) => {
  const { username } = req.body || {};

  if (!username || username.length < 3) {
    return res.json({ available: false, message: 'Le nom d\'utilisateur doit contenir au moins 3 caracteres' });
  }

  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existing) {
      return res.json({ available: false, message: 'Ce nom d\'utilisateur est deja pris' });
    }
    return res.json({ available: true, message: 'Nom d\'utilisateur disponible' });
  } catch {
    return res.json({ available: false, message: 'Erreur de verification' });
  }
});

/** Info for a prefilled invite link (class and school). */
router.get('/invite-info', async (req, res) => {
  const { classe_id: classId, etab_id: schoolId } = req.query;

  if (!classId || !schoolId) {
    return res.status(400).json({ error: 'Parametres manquants' });
  }

  try {
    const schoolClass = await db.get('SELECT c.id, c.nom FROM classes c WHERE c.id = ? AND c.etablissement_id = ?', [classId, schoolId]);
    const school = await db.get('SELECT id, nom, commune, code_postal, latitude, longitude FROM etablissements WHERE id = ?', [schoolId]);

    if (!schoolClass || !school) {
      return res.status(404).json({ error: 'Classe ou etablissement introuvable' });
    }

    res.json({ classe: schoolClass, etablissement: school });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Request to add a school, emailed to the superadmin. */
router.post('/etablissement-request', signupLimiter, async (req, res) => {
  const { nom: name, commune: town, code_postal: postalCode, email_demandeur: requesterEmail } = req.body || {};

  if (!name || !requesterEmail) {
    return res.status(400).json({ error: 'Le nom de l\'etablissement et l\'email sont requis' });
  }

  try {
    await db.run(
      'INSERT INTO etablissement_requests (nom, commune, code_postal, email_demandeur) VALUES (?, ?, ?, ?)',
      [name, town || null, postalCode || null, requesterEmail]
    );

    const superadmin = await db.get('SELECT email FROM users WHERE role = ? AND email IS NOT NULL', ['superadmin']);
    if (superadmin && superadmin.email) {
      await sendSchoolRequestEmail(superadmin.email, name, requesterEmail).catch(err => {
        console.error('Failed to send the school request email:', err);
      });
    }

    res.json({ success: true, message: 'Votre demande a bien ete envoyee. Vous serez informe par email de la suite donnee.' });
  } catch (error) {
    console.error('School request failed:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de la demande' });
  }
});

module.exports = router;
