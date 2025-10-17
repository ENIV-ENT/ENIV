const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/dbHelper');
const router = express.Router();

function requireSuperAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
}

router.post('/classes', requireSuperAdmin, express.json(), async (req, res) => {
  const { nom } = req.body;

  if (!nom) {
    return res.status(400).json({ error: 'Nom de classe requis' });
  }

  try {
    const result = await db.run('INSERT INTO classes (nom) VALUES (?)', [nom]);
    res.json({
      success: true,
      classeId: result.lastInsertRowid,
      message: 'Classe créée avec succès'
    });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la classe' });
  }
});

router.get('/classes', requireSuperAdmin, async (req, res) => {
  try {
    const classes = await db.all('SELECT * FROM classes ORDER BY nom', []);
    res.json({ classes });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des classes' });
  }
});

router.put('/classes/:id', requireSuperAdmin, express.json(), async (req, res) => {
  const { nom } = req.body;

  if (!nom) {
    return res.status(400).json({ error: 'Nom de classe requis' });
  }

  try {
    await db.run('UPDATE classes SET nom = ? WHERE id = ?', [nom, req.params.id]);
    res.json({ success: true, message: 'Classe mise à jour' });
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la classe' });
  }
});

router.delete('/classes/:id', requireSuperAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM classes WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Classe supprimée' });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de la classe' });
  }
});

router.post('/admins', requireSuperAdmin, express.json(), async (req, res) => {
  const { username, password, classe_id } = req.body;

  if (!username || !password || !classe_id) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password, role, classe_id) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, 'admin', classe_id]
    );

    res.json({
      success: true,
      adminId: result.lastInsertRowid,
      message: 'Admin créé avec succès'
    });
  } catch (error) {
    if (error.message.includes('UNIQUE') || error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    } else {
      console.error('Error creating admin:', error);
      res.status(500).json({ error: 'Erreur lors de la création de l\'admin' });
    }
  }
});

router.get('/admins', requireSuperAdmin, async (req, res) => {
  try {
    const admins = await db.all(
      `SELECT u.id, u.username, u.classe_id, u.created_at, c.nom as classe_nom
       FROM users u
       LEFT JOIN classes c ON u.classe_id = c.id
       WHERE u.role = 'admin'
       ORDER BY u.username`,
      []
    );
    res.json({ admins });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des admins' });
  }
});

router.put('/admins/:id', requireSuperAdmin, express.json(), async (req, res) => {
  const { username, password, classe_id } = req.body;

  if (!username || !classe_id) {
    return res.status(400).json({ error: 'Username et classe_id requis' });
  }

  try {
    if (password) {
      const hashedPassword = bcrypt.hashSync(password, 10);
      await db.run(
        'UPDATE users SET username = ?, password = ?, classe_id = ? WHERE id = ? AND role = ?',
        [username, hashedPassword, classe_id, req.params.id, 'admin']
      );
    } else {
      await db.run(
        'UPDATE users SET username = ?, classe_id = ? WHERE id = ? AND role = ?',
        [username, classe_id, req.params.id, 'admin']
      );
    }
    res.json({ success: true, message: 'Admin modifié avec succès' });
  } catch (error) {
    if (error.message.includes('UNIQUE') || error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    } else {
      console.error('Error updating admin:', error);
      res.status(500).json({ error: 'Erreur lors de la modification de l\'admin' });
    }
  }
});

router.delete('/admins/:id', requireSuperAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM users WHERE id = ? AND role = ?', [req.params.id, 'admin']);
    res.json({ success: true, message: 'Admin supprimé' });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'admin' });
  }
});

router.post('/change-password', requireSuperAdmin, express.json(), async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const validPassword = bcrypt.compareSync(oldPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du mot de passe' });
  }
});

module.exports = router;
