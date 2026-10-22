const express = require('express');
const db = require('../models/dbHelper');
const { requireAuth } = require('../middleware/auth');
const { commentLimiter } = require('../middleware/rateLimit');
const { logAssignmentAction } = require('../services/assignmentLogger');
const { findClassAssignment } = require('../services/classMembership');
const push = require('../services/push');
const pushMessages = require('../services/pushMessages');

/** Mounted on /api/devoirs/:assignmentId/commentaires. */
const router = express.Router({ mergeParams: true });

const MAX_LENGTH = 2000;

router.use(requireAuth);

/**
 * The assignment must exist and belong to the user's class. Integer ids only:
 * MySQL would read "10abc" as 10. The assignment found ({ id, titre }) is kept in
 * res.locals.assignment.
 */
async function requireClassAssignment(req, res, next) {
  const validIds = [req.params.assignmentId, req.params.commentId ?? '0'].every((id) => /^\d+$/.test(id));
  const assignment = validIds
    ? await findClassAssignment(req.params.assignmentId, req.user.classe_id)
    : null;
  if (!assignment) {
    return res.status(404).json({ error: 'Devoir non trouvé' });
  }
  res.locals.assignment = assignment;
  next();
}

/**
 * Joins the new comment count to the realtime notification: the class updates its
 * badge without reloading every assignment (without a count, clients reload the
 * assignments). Never throws: the comment is already saved, a 500 would push the
 * user to send it again.
 */
async function attachCommentCount(req, res) {
  try {
    const { n } = await db.get('SELECT COUNT(*) AS n FROM devoir_commentaires WHERE devoir_id = ?', [req.params.assignmentId]);
    res.locals.realtimeData = { nbCommentaires: Number(n) };
  } catch (error) {
    console.error('Error counting comments:', error);
  }
}

/** The author and the admins of the class can delete a comment. */
router.get('/', requireClassAssignment, async (req, res) => {
  try {
    const comments = await db.all(
      `SELECT c.id, c.contenu, c.created_at, c.user_id,
              u.username, u.prenom, u.nom
       FROM devoir_commentaires c
       JOIN users u ON u.id = c.user_id
       WHERE c.devoir_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [req.params.assignmentId]
    );

    const isAdmin = req.user.role === 'admin';
    res.json(comments.map((c) => ({ ...c, supprimable: isAdmin || c.user_id === req.user.id })));
  } catch (error) {
    console.error('Error listing comments:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des commentaires' });
  }
});

router.post('/', commentLimiter, express.json(), requireClassAssignment, async (req, res) => {
  const content = typeof req.body?.contenu === 'string' ? req.body.contenu.trim() : '';
  if (!content) {
    return res.status(400).json({ error: 'Commentaire vide' });
  }
  if (content.length > MAX_LENGTH) {
    return res.status(400).json({ error: `${MAX_LENGTH} caractères maximum` });
  }

  try {
    const result = await db.run(
      'INSERT INTO devoir_commentaires (devoir_id, user_id, contenu) VALUES (?, ?, ?)',
      [req.params.assignmentId, req.user.id, content]
    );
    await attachCommentCount(req, res);

    const author = [req.user.prenom, req.user.nom].filter(Boolean).join(' ') || req.user.username;
    const { assignment } = res.locals;
    push.notifyCommentInBackground(req.user.classe_id, assignment.id,
      pushMessages.newComment({ assignmentId: assignment.id, title: assignment.titre, author, content }),
      req.user.id);

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire" });
  }
});

/** The deleted message and its author are kept in the History tab. */
router.delete('/:commentId', requireClassAssignment, async (req, res) => {
  try {
    const comment = await db.get(
      `SELECT c.id, c.user_id, c.contenu, c.created_at,
              u.username, u.prenom, u.nom, d.titre AS devoir_titre
       FROM devoir_commentaires c
       JOIN users u ON u.id = c.user_id
       JOIN devoirs d ON d.id = c.devoir_id
       WHERE c.id = ? AND c.devoir_id = ?`,
      [req.params.commentId, req.params.assignmentId]
    );
    if (!comment) {
      return res.status(404).json({ error: 'Commentaire non trouvé' });
    }
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres commentaires' });
    }

    await db.run('DELETE FROM devoir_commentaires WHERE id = ?', [comment.id]);

    await logAssignmentAction(req, {
      assignmentId: Number(req.params.assignmentId),
      action: 'delete_commentaire',
      details: {
        titre: comment.devoir_titre,
        commentaire: {
          contenu: comment.contenu,
          created_at: comment.created_at,
          auteur: {
            username: comment.username,
            prenom: comment.prenom,
            nom: comment.nom
          }
        }
      }
    });

    await attachCommentCount(req, res);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du commentaire' });
  }
});

module.exports = router;
