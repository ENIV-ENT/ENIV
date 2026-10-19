const express = require('express');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const { commentLimiter } = require('../middleware/rateLimit');
const { logDevoirAction } = require('../services/devoirLogger');

// Monté sur /api/devoirs/:devoirId/commentaires
const router = express.Router({ mergeParams: true });

const MAX_LENGTH = 2000;

router.use(requireAuth);

// Le devoir doit exister et appartenir à la classe de l'utilisateur.
// Identifiants entiers seulement : MySQL lirait « 10abc » comme 10.
async function devoirDeLaClasse(req, res, next) {
  const idsValides = [req.params.devoirId, req.params.commentaireId ?? '0'].every((id) => /^\d+$/.test(id));
  const devoir = idsValides && req.user.classe_id
    ? await db.get('SELECT id FROM devoirs WHERE id = ? AND classe_id = ?', [req.params.devoirId, req.user.classe_id])
    : null;
  if (!devoir) {
    return res.status(404).json({ error: 'Devoir non trouvé' });
  }
  next();
}

// Joint le nouveau nombre de commentaires à la notification temps réel : la
// classe met à jour son badge sans recharger tous les devoirs
// (sans nombre, les clients rechargent les devoirs). Ne lève jamais d'erreur :
// le commentaire est déjà enregistré, un 500 pousserait à le renvoyer.
async function joindreNombre(req, res) {
  try {
    const { n } = await db.get('SELECT COUNT(*) AS n FROM devoir_commentaires WHERE devoir_id = ?', [req.params.devoirId]);
    res.locals.realtimeData = { nbCommentaires: Number(n) };
  } catch (error) {
    console.error('Error counting comments:', error);
  }
}

router.get('/', devoirDeLaClasse, async (req, res) => {
  try {
    const commentaires = await db.all(
      `SELECT c.id, c.contenu, c.created_at, c.user_id,
              u.username, u.prenom, u.nom
       FROM devoir_commentaires c
       JOIN users u ON u.id = c.user_id
       WHERE c.devoir_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [req.params.devoirId]
    );

    // L'auteur et les admins de la classe peuvent supprimer un commentaire
    const estAdmin = req.user.role === 'admin';
    res.json(commentaires.map((c) => ({ ...c, supprimable: estAdmin || c.user_id === req.user.id })));
  } catch (error) {
    console.error('Error listing comments:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des commentaires' });
  }
});

router.post('/', commentLimiter, express.json(), devoirDeLaClasse, async (req, res) => {
  const contenu = typeof req.body?.contenu === 'string' ? req.body.contenu.trim() : '';
  if (!contenu) {
    return res.status(400).json({ error: 'Commentaire vide' });
  }
  if (contenu.length > MAX_LENGTH) {
    return res.status(400).json({ error: `${MAX_LENGTH} caractères maximum` });
  }

  try {
    const result = await db.run(
      'INSERT INTO devoir_commentaires (devoir_id, user_id, contenu) VALUES (?, ?, ?)',
      [req.params.devoirId, req.user.id, contenu]
    );
    await joindreNombre(req, res);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire" });
  }
});

router.delete('/:commentaireId', devoirDeLaClasse, async (req, res) => {
  try {
    const commentaire = await db.get(
      `SELECT c.id, c.user_id, c.contenu, c.created_at,
              u.username, u.prenom, u.nom, d.titre AS devoir_titre
       FROM devoir_commentaires c
       JOIN users u ON u.id = c.user_id
       JOIN devoirs d ON d.id = c.devoir_id
       WHERE c.id = ? AND c.devoir_id = ?`,
      [req.params.commentaireId, req.params.devoirId]
    );
    if (!commentaire) {
      return res.status(404).json({ error: 'Commentaire non trouvé' });
    }
    if (commentaire.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres commentaires' });
    }

    await db.run('DELETE FROM devoir_commentaires WHERE id = ?', [commentaire.id]);

    // Garder une trace du message supprimé et de son auteur dans l'Historique
    await logDevoirAction(req, {
      devoirId: Number(req.params.devoirId),
      action: 'delete_commentaire',
      details: {
        titre: commentaire.devoir_titre,
        commentaire: {
          contenu: commentaire.contenu,
          created_at: commentaire.created_at,
          auteur: {
            username: commentaire.username,
            prenom: commentaire.prenom,
            nom: commentaire.nom
          }
        }
      }
    });

    await joindreNombre(req, res);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du commentaire' });
  }
});

module.exports = router;
