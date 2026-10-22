/**
 * Quiz creation page: attaches a JSON question set to an existing assignment.
 * @module quizCreate
 */

function goBack() {
  window.location.href = '/admin';
}

function showAlert(type, message) {
  const alert = document.getElementById('alert');
  alert.className = `alert ${type}`;
  alert.textContent = message;
  alert.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => {
      alert.style.display = 'none';
    }, 3000);
  }
}

/**
 * Parses and checks the questions typed by the user.
 * @param {string} text - JSON array of `{ question, options, correct, explanation?, example? }`
 * @returns {Array<object>}
 * @throws {Error} With a French message shown to the user
 */
function parseQuestions(text) {
  const questions = JSON.parse(text);
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Le JSON doit être un tableau non vide');
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question || !Array.isArray(q.options) || q.correct === undefined) {
      throw new Error(`Question ${i + 1} : format invalide (question, options et correct sont obligatoires)`);
    }
    if (q.options.length < 2 || q.options.length > 4) {
      throw new Error(`Question ${i + 1} : il faut entre 2 et 4 options`);
    }
    if (q.correct < 0 || q.correct >= q.options.length) {
      throw new Error(`Question ${i + 1} : l'index correct est invalide`);
    }
  }
  return questions;
}

async function handleSubmit(e) {
  e.preventDefault();

  const assignmentId = document.getElementById('assignment-id').value;
  const mode = document.getElementById('mode').value;
  const questionsText = document.getElementById('questions').value;

  let questions;
  try {
    questions = parseQuestions(questionsText);
  } catch (error) {
    showAlert('error', 'Erreur JSON : ' + error.message);
    return;
  }

  try {
    const response = await fetch('/api/quiz/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        devoirId: parseInt(assignmentId),
        questions: questions,
        mode: mode
      })
    });

    const data = await response.json();

    if (response.ok) {
      showAlert('success', 'Quiz créé avec succès !');
      setTimeout(() => {
        window.location.href = '/admin';
      }, 2000);
    } else {
      showAlert('error', data.error || 'Erreur lors de la création du quiz');
    }
  } catch (error) {
    console.error(error);
    showAlert('error', 'Erreur de connexion au serveur');
  }
}

document.getElementById('quiz-form').addEventListener('submit', handleSubmit);
document.getElementById('back-btn').addEventListener('click', goBack);
document.getElementById('cancel-btn').addEventListener('click', goBack);
