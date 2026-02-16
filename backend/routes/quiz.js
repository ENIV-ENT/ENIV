const express = require('express');
const db = require('../models/dbHelper');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/quiz/:devoirId
 * Récupérer les questions d'un quiz pour un devoir donné
 */
router.get('/:devoirId', async (req, res) => {
  try {
    const { devoirId } = req.params;

    // Vérifier que l'utilisateur a accès à ce devoir
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer le devoir
    const devoir = await db.get(
      'SELECT d.*, dq.questions_json, dq.mode FROM devoirs d LEFT JOIN devoir_quiz dq ON d.id = dq.devoir_id WHERE d.id = ? AND d.classe_id = ?',
      [devoirId, classeId]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    // Si le devoir n'a pas de quiz associé
    if (!devoir.questions_json) {
      return res.status(404).json({ error: 'Ce devoir n\'a pas de quiz associé' });
    }

    // Parser le JSON des questions
    let questions = [];
    try {
      questions = JSON.parse(devoir.questions_json);
    } catch (e) {
      console.error('Erreur parsing JSON:', e);
      return res.status(500).json({ error: 'Format de questions invalide' });
    }

    res.json({
      titre: devoir.titre,
      description: devoir.description,
      mode: devoir.mode || 'both',
      questions: questions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération du quiz' });
  }
});

/**
 * POST /api/quiz/results
 * Sauvegarder les résultats d'un quiz
 */
router.post('/results', express.json(), async (req, res) => {
  try {
    const { devoirId, score, totalQuestions, correctAnswers, incorrectAnswers, mode } = req.body;

    if (!devoirId || score === undefined || !totalQuestions || !mode) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Vérifier que l'utilisateur a accès à ce devoir
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Récupérer le quiz
    const quiz = await db.get(
      'SELECT dq.id FROM devoir_quiz dq JOIN devoirs d ON dq.devoir_id = d.id WHERE d.id = ? AND d.classe_id = ?',
      [devoirId, classeId]
    );

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz non trouvé' });
    }

    // Sauvegarder le résultat
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
 * GET /api/quiz/:devoirId/results
 * Récupérer les résultats d'un quiz pour l'utilisateur connecté
 */
router.get('/:devoirId/results', async (req, res) => {
  try {
    const { devoirId } = req.params;

    // Récupérer le quiz
    const quiz = await db.get(
      'SELECT dq.id FROM devoir_quiz dq WHERE dq.devoir_id = ?',
      [devoirId]
    );

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz non trouvé' });
    }

    // Récupérer les résultats de l'utilisateur
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
 * Créer un quiz pour un devoir (admin seulement)
 */
router.post('/create', requireAdmin, express.json(), async (req, res) => {
  try {
    const { devoirId, questions, mode } = req.body;

    if (!devoirId || !questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Données manquantes ou invalides' });
    }

    // Vérifier que l'utilisateur a accès à ce devoir
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Vérifier que le devoir existe et appartient à la même classe
    const devoir = await db.get(
      'SELECT id FROM devoirs WHERE id = ? AND classe_id = ?',
      [devoirId, classeId]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    // Créer ou mettre à jour le quiz
    const questionsJson = JSON.stringify(questions);
    const modeValue = mode || 'both';

    // Vérifier si un quiz existe déjà pour ce devoir
    const existingQuiz = await db.get('SELECT id FROM devoir_quiz WHERE devoir_id = ?', [devoirId]);

    if (existingQuiz) {
      // Mettre à jour
      await db.run(
        'UPDATE devoir_quiz SET questions_json = ?, mode = ? WHERE devoir_id = ?',
        [questionsJson, modeValue, devoirId]
      );
    } else {
      // Créer
      await db.run(
        'INSERT INTO devoir_quiz (devoir_id, questions_json, mode) VALUES (?, ?, ?)',
        [devoirId, questionsJson, modeValue]
      );
    }

    res.json({ success: true, message: 'Quiz créé avec succès' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création du quiz' });
  }
});

/**
 * DELETE /api/quiz/:devoirId
 * Supprimer un quiz (admin seulement)
 */
router.delete('/:devoirId', requireAdmin, async (req, res) => {
  try {
    const { devoirId } = req.params;

    // Vérifier que l'utilisateur a accès à ce devoir
    const classeId = req.user.classe_id;
    if (!classeId) {
      return res.status(403).json({ error: 'Utilisateur non associé à une classe' });
    }

    // Vérifier que le devoir existe et appartient à la même classe
    const devoir = await db.get(
      'SELECT id FROM devoirs WHERE id = ? AND classe_id = ?',
      [devoirId, classeId]
    );

    if (!devoir) {
      return res.status(404).json({ error: 'Devoir non trouvé' });
    }

    // Supprimer le quiz
    await db.run('DELETE FROM devoir_quiz WHERE devoir_id = ?', [devoirId]);

    res.json({ success: true, message: 'Quiz supprimé' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la suppression du quiz' });
  }
});

module.exports = router;
