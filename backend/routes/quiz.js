const express = require('express');
const db = require('../models/dbHelper');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { findClassAssignment } = require('../services/classMembership');
const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/quiz/:assignmentId
 * Questions of the quiz of an assignment of the user's class.
 * The MariaDB JSON column comes already decoded from mysql2 (3.x).
 */
router.get('/:assignmentId', async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await db.get(
      'SELECT d.*, dq.questions_json, dq.mode FROM devoirs d LEFT JOIN devoir_quiz dq ON d.id = dq.devoir_id WHERE d.id = ? AND d.classe_id = ?',
      [assignmentId, classId]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    if (!assignment.questions_json) {
      return res.status(404).json({ error: 'Ce devoir n\'a pas de quiz associé' });
    }

    let questions = [];
    try {
      questions = typeof assignment.questions_json === 'string'
        ? JSON.parse(assignment.questions_json)
        : assignment.questions_json;
    } catch (e) {
      console.error('Invalid questions JSON:', e);
      return res.status(500).json({ error: 'Format de questions invalide' });
    }

    res.json({
      titre: assignment.titre,
      description: assignment.description,
      mode: assignment.mode || 'both',
      questions: questions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération du quiz' });
  }
});

/**
 * POST /api/quiz/results
 * Saves the result of a quiz.
 */
router.post('/results', express.json(), async (req, res) => {
  try {
    const { devoirId: assignmentId, score, totalQuestions, correctAnswers, incorrectAnswers, mode } = req.body || {};

    if (!assignmentId || score === undefined || !totalQuestions || !mode) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    const quiz = await db.get(
      'SELECT dq.id FROM devoir_quiz dq JOIN devoirs d ON dq.devoir_id = d.id WHERE d.id = ? AND d.classe_id = ?',
      [assignmentId, classId]
    );

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz non trouvé' });
    }

    await db.run(
      'INSERT INTO quiz_results (devoir_quiz_id, user_id, score, total_questions, correct_answers, incorrect_answers, mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [quiz.id, req.session.userId, score, totalQuestions, correctAnswers, incorrectAnswers, mode]
    );

    res.json({ success: true, message: 'Résultats sauvegardés' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des résultats' });
  }
});

/**
 * GET /api/quiz/:assignmentId/results
 * Quiz results of the logged-in user.
 */
router.get('/:assignmentId/results', async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const quiz = await db.get(
      'SELECT dq.id FROM devoir_quiz dq WHERE dq.devoir_id = ?',
      [assignmentId]
    );

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz non trouvé' });
    }

    const results = await db.all(
      'SELECT * FROM quiz_results WHERE devoir_quiz_id = ? AND user_id = ? ORDER BY completed_at DESC',
      [quiz.id, req.session.userId]
    );

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des résultats' });
  }
});

/**
 * POST /api/quiz/create
 * Creates or replaces the quiz of an assignment of the class (admin only).
 */
router.post('/create', requireAdmin, express.json(), async (req, res) => {
  try {
    const { devoirId: assignmentId, questions, mode } = req.body || {};

    if (!assignmentId || !questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Données manquantes ou invalides' });
    }

    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await findClassAssignment(assignmentId, classId);

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    const questionsJson = JSON.stringify(questions);
    const modeValue = mode || 'both';

    const existingQuiz = await db.get('SELECT id FROM devoir_quiz WHERE devoir_id = ?', [assignmentId]);

    if (existingQuiz) {
      await db.run(
        'UPDATE devoir_quiz SET questions_json = ?, mode = ? WHERE devoir_id = ?',
        [questionsJson, modeValue, assignmentId]
      );
    } else {
      await db.run(
        'INSERT INTO devoir_quiz (devoir_id, questions_json, mode) VALUES (?, ?, ?)',
        [assignmentId, questionsJson, modeValue]
      );
    }

    res.json({ success: true, message: 'Quiz créé avec succès' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création du quiz' });
  }
});

/**
 * DELETE /api/quiz/:assignmentId
 * Deletes the quiz of an assignment of the class (admin only).
 */
router.delete('/:assignmentId', requireAdmin, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const classId = req.user.classe_id;
    if (!classId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    const assignment = await findClassAssignment(assignmentId, classId);

    if (!assignment) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    await db.run('DELETE FROM devoir_quiz WHERE devoir_id = ?', [assignmentId]);

    res.json({ success: true, message: 'Quiz supprimé' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la suppression du quiz' });
  }
});

module.exports = router;
