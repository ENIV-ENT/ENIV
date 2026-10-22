import {escapeHtml} from "../js/utils/dom.js";
import {mountHeader, setHeaderUser} from "../js/components/header.js";

let quizData = null;
let currentQuestions = [];
let currentQuestionIndex = 0;
let selectedOption = null;
let score = 0;
let correctCount = 0;
let incorrectCount = 0;
let answered = false;
let quizMode = null;
/** Answered questions, which can no longer be changed. */
let answeredQuestions = new Set();
/** Answers by question index: `{ selectedOption, isCorrect, mode }`. */
let answersHistory = {};
let assignmentId = null;
let userId = null;
/** Shuffled order of the questions: indexes in quizData.questions. */
let questionOrder = [];
let resolveUserReady;
const userReady = new Promise((resolve) => { resolveUserReady = resolve; });

/**
 * Quiz resume: the progress stays in the browser until the quiz is finished or
 * abandoned, so reloading or leaving the page no longer loses everything.
 * Saving is a convenience: when storage is full or refused, the quiz goes on.
 */
const SAVE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function saveKey() {
    return `eniv-quiz-${userId ?? 'anonyme'}-${assignmentId}`;
}

/** Fingerprint of the content: a regenerated or edited quiz invalidates the saved progress. */
function quizSignature(questions) {
    let hash = 5381;
    const text = JSON.stringify(questions.map(q => [q.question, q.options]));
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return `${questions.length}:${hash}`;
}

function saveProgress() {
    if (!quizMode || !quizData) return;
    try {
        localStorage.setItem(saveKey(), JSON.stringify({
            savedAt: Date.now(),
            signature: quizSignature(quizData.questions || []),
            mode: quizMode,
            order: questionOrder,
            options: currentQuestions.map(q => (q.shuffledOptions ? q.shuffledOptions.map(o => o.originalIndex) : null)),
            index: currentQuestionIndex,
            score,
            correct: correctCount,
            incorrect: incorrectCount,
            answered: [...answeredQuestions],
            history: answersHistory
        }));
    } catch {
        return;
    }
}

function clearProgress() {
    try {
        localStorage.removeItem(saveKey());
    } catch {
        return;
    }
}

const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;

/**
 * Saved progress when it still matches this quiz, otherwise null. A quiz
 * restricted to one mode does not resume in the other ('both' allows both).
 */
function readProgress() {
    try {
        const saved = JSON.parse(localStorage.getItem(saveKey()));
        const questions = quizData.questions || [];
        if (!saved || Date.now() - saved.savedAt > SAVE_MAX_AGE_MS) return null;
        if (saved.signature !== quizSignature(questions)) return null;
        if (saved.mode !== 'choice' && saved.mode !== 'oral') return null;
        const forcedMode = quizData.mode === 'choice' || quizData.mode === 'oral';
        if (forcedMode && quizData.mode !== saved.mode) return null;

        const n = questions.length;
        const order = saved.order;
        if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n || !order.every(i => isIndex(i, n))) return null;
        if (!isIndex(saved.index, n)) return null;
        if (!Array.isArray(saved.answered) || !saved.answered.every(i => isIndex(i, n))) return null;
        if (!Array.isArray(saved.options) || saved.options.length !== n) return null;

        const validOptions = saved.options.every((perm, i) => {
            if (perm === null) return true;
            const count = questions[order[i]].options.length;
            return Array.isArray(perm) && perm.length === count && new Set(perm).size === count && perm.every(o => isIndex(o, count));
        });
        if (!validOptions) return null;
        if (!saved.history || typeof saved.history !== 'object') return null;
        return saved;
    } catch {
        return null;
    }
}

function resumeQuiz(saved) {
    quizMode = saved.mode;
    questionOrder = saved.order;
    currentQuestions = questionOrder.map(i => quizData.questions[i]);
    currentQuestions.forEach((question, i) => {
        const perm = saved.options[i];
        if (perm) {
            question.shuffledOptions = perm.map(o => ({ text: question.options[o], originalIndex: o }));
        } else {
            delete question.shuffledOptions;
        }
    });

    currentQuestionIndex = saved.index;
    score = saved.score || 0;
    correctCount = saved.correct || 0;
    incorrectCount = saved.incorrect || 0;
    answeredQuestions = new Set(saved.answered);
    answersHistory = saved.history;

    updateStats();
    document.getElementById('resume-notice').style.display = 'block';
    document.getElementById('mode-selector').style.display = 'none';
    document.getElementById('progress-bar').style.display = 'block';
    document.getElementById('quiz-card').style.display = 'block';
    loadQuestion();
}

/**
 * Abandons the quiz and erases the saved progress. A quiz restricted to one
 * mode has nothing to choose, so it goes back to the assignments.
 */
function abandonQuiz() {
    if (!confirm('Abandonner ce quiz ? Votre progression sera perdue.')) return;
    clearProgress();

    if (quizData.mode === 'choice' || quizData.mode === 'oral') {
        window.location.href = '/dashboard';
        return;
    }

    answeredQuestions.clear();
    answersHistory = {};
    score = 0;
    correctCount = 0;
    incorrectCount = 0;
    quizMode = null;
    updateStats();
    document.getElementById('resume-notice').style.display = 'none';
    document.getElementById('quiz-card').style.display = 'none';
    document.getElementById('progress-bar').style.display = 'none';
    document.getElementById('mode-selector').style.display = 'block';
}

/** Escapes the text and turns '''code''' and ```code``` into code blocks. */
function formatTextWithCode(text) {
    if (!text) return '';

    let result = escapeHtml(text);

    function replacer(match, code) {
      return `<pre><code>${code.trim()}</code></pre>`;
    }

    result = result.replace(/'''([\s\S]*?)'''/g, replacer);
    result = result.replace(/```([\s\S]*?)```/g, replacer);

    return result;
}

function getAssignmentIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

async function loadQuizData() {
    try {
        assignmentId = getAssignmentIdFromUrl();
        if (!assignmentId) {
            alert('Aucun quiz spécifié');
            window.location.href = '/dashboard';
            return;
        }

        const response = await fetch(`/api/quiz/${assignmentId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Quiz loading failed');
        }

        quizData = await response.json();

        document.getElementById('quiz-title').textContent = quizData.titre || 'Quiz';

        await userReady;
        const saved = readProgress();
        if (saved) {
            resumeQuiz(saved);
            return;
        }

        document.getElementById('mode-selector').style.display = 'block';

        if (quizData.mode === 'choice') {
            startQuiz('choice');
        } else if (quizData.mode === 'oral') {
            startQuiz('oral');
        }
    } catch (error) {
        console.error('Quiz error:', error);
        alert('Impossible de charger le quiz');
        window.location.href = '/dashboard';
    }
}

function startQuiz(mode) {
    quizMode = mode;
    currentQuestions = quizData.questions || [];

    if (currentQuestions.length === 0) {
        alert('Ce quiz ne contient aucune question');
        return;
    }

    questionOrder = shuffleArray(currentQuestions.map((_, i) => i));
    currentQuestions = questionOrder.map(i => currentQuestions[i]);
    currentQuestionIndex = 0;
    score = 0;
    correctCount = 0;
    incorrectCount = 0;
    answeredQuestions.clear();
    answersHistory = {};

    updateStats();
    document.getElementById('mode-selector').style.display = 'none';
    document.getElementById('progress-bar').style.display = 'block';
    document.getElementById('quiz-card').style.display = 'block';

    loadQuestion();
}

function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

function loadQuestion() {
    const isAlreadyAnswered = answeredQuestions.has(currentQuestionIndex);
    answered = isAlreadyAnswered;
    selectedOption = null;

    const question = currentQuestions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / currentQuestions.length) * 100;
    document.getElementById('progress-fill').style.width = progress + '%';
    document.getElementById('question-number').textContent =
        `Question ${currentQuestionIndex + 1} sur ${currentQuestions.length}`;
    document.getElementById('question').innerHTML = formatTextWithCode(question.question);

    document.getElementById('explanation').classList.remove('show');
    document.getElementById('options').style.display = 'none';
    document.getElementById('oral-response').style.display = 'none';
    document.getElementById('validate-btn').style.display = 'none';
    document.getElementById('next-btn').style.display = 'none';

    const existingRecap = document.getElementById('recap');
    if (existingRecap) {
        existingRecap.remove();
    }

    if (quizMode === 'choice') {
        document.getElementById('options').style.display = 'flex';

        if (!isAlreadyAnswered) {
            document.getElementById('validate-btn').style.display = 'inline-block';
        } else {
            document.getElementById('next-btn').style.display = 'inline-block';
        }

        const optionsContainer = document.getElementById('options');
        optionsContainer.innerHTML = '';

        const shuffledOptions = question.options.map((option, index) => ({
            text: option,
            originalIndex: index
        }));

        if (!isAlreadyAnswered && !question.shuffledOptions) {
            question.shuffledOptions = shuffleArray(shuffledOptions);
        } else if (!question.shuffledOptions) {
            question.shuffledOptions = shuffledOptions;
        }

        question.shuffledOptions.forEach((option, displayIndex) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'option';

            if (!isAlreadyAnswered) {
                optionDiv.onclick = () => selectOption(displayIndex);
            } else {
                optionDiv.style.cursor = 'not-allowed';
                optionDiv.style.opacity = '0.7';
            }
            const letter = String.fromCharCode(65 + displayIndex);
            optionDiv.innerHTML = `
                <div class="option-letter">${escapeHtml(letter)}</div>
                <div class="option-text">${formatTextWithCode(option.text)}</div>
            `;

            optionsContainer.appendChild(optionDiv);
        });

        if (isAlreadyAnswered && answersHistory[currentQuestionIndex]) {
            const history = answersHistory[currentQuestionIndex];
            const options = document.querySelectorAll('.option');
            
            const correctDisplayIndex = question.shuffledOptions.findIndex(
                opt => opt.originalIndex === question.correct
            );

            if (history.isCorrect) {
                options[history.selectedOption].classList.add('correct');
            } else {
                options[history.selectedOption].classList.add('incorrect');
                options[correctDisplayIndex].classList.add('correct');
            }

            if (question.explanation) {
                document.getElementById('explanation-text').innerHTML = formatTextWithCode(question.explanation);
                if (question.example) {
                    document.getElementById('example-text').innerHTML = formatTextWithCode(question.example);
                    document.getElementById('example').style.display = 'block';
                } else {
                    document.getElementById('example').style.display = 'none';
                }
                document.getElementById('explanation').classList.add('show');
            }
        }
    } else {
        document.getElementById('oral-response').style.display = 'block';

        if (!isAlreadyAnswered) {
            document.getElementById('show-answer-btn').style.display = 'inline-block';
        } else {
            document.getElementById('show-answer-btn').style.display = 'none';
            document.getElementById('next-btn').style.display = 'inline-block';
        }

        document.getElementById('self-evaluation').style.display = 'none';
        document.getElementById('correct-answer').style.display = 'none';
        document.getElementById('correct-answer').innerHTML = '';

        if (isAlreadyAnswered && answersHistory[currentQuestionIndex]) {
            const history = answersHistory[currentQuestionIndex];
            const correctAnswerDiv = document.getElementById('correct-answer');
            correctAnswerDiv.innerHTML = `<strong>Réponse correcte:</strong> ${formatTextWithCode(question.options[question.correct])}`;
            correctAnswerDiv.style.display = 'block';

            document.getElementById('self-evaluation').style.display = 'block';
            const evalButtons = document.querySelectorAll('.eval-buttons button');
            evalButtons.forEach(btn => btn.disabled = true);
            if (question.explanation) {
                document.getElementById('explanation-text').innerHTML = formatTextWithCode(question.explanation);
                if (question.example) {
                    document.getElementById('example-text').innerHTML = formatTextWithCode(question.example);
                    document.getElementById('example').style.display = 'block';
                } else {
                    document.getElementById('example').style.display = 'none';
                }
                document.getElementById('explanation').classList.add('show');
            }

            if (!history.isCorrect) {
                const recapDiv = document.createElement('div');
                recapDiv.id = 'recap';
                recapDiv.className = 'recap';
                recapDiv.innerHTML = `
                    <strong>Récapitulatif:</strong>
                    <p>${formatTextWithCode(question.question)}</p>
                    <p><strong>Réponse:</strong> ${formatTextWithCode(question.options[question.correct])}</p>
                    ${question.explanation ? `<p>${formatTextWithCode(question.explanation)}</p>` : ''}
                `;
                const correctAnswerDiv = document.getElementById('correct-answer');
                correctAnswerDiv.parentNode.insertBefore(recapDiv, correctAnswerDiv.nextSibling);
            }
        }
    }

    document.getElementById('prev-btn').disabled = currentQuestionIndex === 0;

    saveProgress();
}

function selectOption(index) {
    if (answered || answeredQuestions.has(currentQuestionIndex)) return;

    const options = document.querySelectorAll('.option');
    options.forEach(opt => opt.classList.remove('selected'));
    options[index].classList.add('selected');
    selectedOption = index;
}

function validateAnswer() {
    if (selectedOption === null || answered || answeredQuestions.has(currentQuestionIndex)) return;

    answered = true;
    answeredQuestions.add(currentQuestionIndex);

    const question = currentQuestions[currentQuestionIndex];
    const options = document.querySelectorAll('.option');

    options.forEach(opt => {
        opt.style.cursor = 'not-allowed';
        opt.onclick = null;
    });

    const selectedOriginalIndex = question.shuffledOptions[selectedOption].originalIndex;
    const isCorrect = selectedOriginalIndex === question.correct;

    const correctDisplayIndex = question.shuffledOptions.findIndex(
        opt => opt.originalIndex === question.correct
    );

    answersHistory[currentQuestionIndex] = {
        selectedOption: selectedOption,
        isCorrect: isCorrect,
        mode: 'choice'
    };

    if (isCorrect) {
        options[selectedOption].classList.add('correct');
        score += 10;
        correctCount++;
    } else {
        options[selectedOption].classList.add('incorrect');
        options[correctDisplayIndex].classList.add('correct');
        incorrectCount++;
    }

    if (question.explanation) {
        document.getElementById('explanation-text').innerHTML = formatTextWithCode(question.explanation);
        if (question.example) {
            document.getElementById('example-text').innerHTML = formatTextWithCode(question.example);
            document.getElementById('example').style.display = 'block';
        } else {
            document.getElementById('example').style.display = 'none';
        }
        document.getElementById('explanation').classList.add('show');
    }

    updateStats();
    saveProgress();

    document.getElementById('validate-btn').style.display = 'none';
    document.getElementById('next-btn').style.display = 'inline-block';
}

function showAnswer() {
    if (answered || answeredQuestions.has(currentQuestionIndex)) return;

    const question = currentQuestions[currentQuestionIndex];
    answered = true;

    const correctAnswerDiv = document.getElementById('correct-answer');
    correctAnswerDiv.innerHTML = `<strong>Réponse correcte:</strong> ${formatTextWithCode(question.options[question.correct])}`;
    correctAnswerDiv.style.display = 'block';

    document.getElementById('self-evaluation').style.display = 'block';
    document.getElementById('show-answer-btn').style.display = 'none';

    if (question.explanation) {
        document.getElementById('explanation-text').innerHTML = formatTextWithCode(question.explanation);
        if (question.example) {
            document.getElementById('example-text').innerHTML = formatTextWithCode(question.example);
            document.getElementById('example').style.display = 'block';
        } else {
            document.getElementById('example').style.display = 'none';
        }
        document.getElementById('explanation').classList.add('show');
    }

    const evalButtons = document.querySelectorAll('.eval-buttons button');
    evalButtons.forEach(btn => btn.disabled = false);
}

function evaluateAnswer(isCorrect) {
    if (answeredQuestions.has(currentQuestionIndex)) return;

    answeredQuestions.add(currentQuestionIndex);

    answersHistory[currentQuestionIndex] = {
        selectedOption: null,
        isCorrect: isCorrect,
        mode: 'oral'
    };

    const existingRecap = document.getElementById('recap');
    if (existingRecap) {
        existingRecap.remove();
    }

    if (isCorrect) {
        score += 10;
        correctCount++;
    } else {
        incorrectCount++;

        const question = currentQuestions[currentQuestionIndex];
        const recapDiv = document.createElement('div');
        recapDiv.id = 'recap';
        recapDiv.className = 'recap';
        recapDiv.innerHTML = `
            <strong>Récapitulatif:</strong>
            <p>${formatTextWithCode(question.question)}</p>
            <p><strong>Réponse:</strong> ${formatTextWithCode(question.options[question.correct])}</p>
            ${question.explanation ? `<p>${formatTextWithCode(question.explanation)}</p>` : ''}
        `;

        const correctAnswerDiv = document.getElementById('correct-answer');
        correctAnswerDiv.parentNode.insertBefore(recapDiv, correctAnswerDiv.nextSibling);
    }

    updateStats();
    saveProgress();

    const evalButtons = document.querySelectorAll('.eval-buttons button');
    evalButtons.forEach(btn => btn.disabled = true);

    document.getElementById('next-btn').style.display = 'inline-block';
}

function nextQuestion() {
    if (currentQuestionIndex < currentQuestions.length - 1) {
        currentQuestionIndex++;
        loadQuestion();
    } else {
        showResults();
    }
}

function previousQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        loadQuestion();
    }
}

function updateStats() {
    document.getElementById('score').textContent = score;
    document.getElementById('correct').textContent = correctCount;
    document.getElementById('incorrect').textContent = incorrectCount;
}

async function showResults() {
    clearProgress();
    document.getElementById('quiz-card').style.display = 'none';
    document.getElementById('progress-bar').style.display = 'none';

    const percentage = Math.round((correctCount / currentQuestions.length) * 100);
    document.getElementById('final-score').textContent = percentage + '%';

    let message;
    if (percentage >= 90) {
        message = '🌟 Excellent ! Vous maîtrisez parfaitement le sujet !';
    } else if (percentage >= 70) {
        message = '👍 Très bien ! Vous avez de bonnes connaissances !';
    } else if (percentage >= 50) {
        message = '👌 Pas mal ! Continuez à vous entraîner !';
    } else {
        message = '💪 Il faut réviser un peu plus ! Ne baissez pas les bras !';
    }

    document.getElementById('result-message').textContent = message;
    document.getElementById('result-card').classList.add('show');

    try {
        await fetch('/api/quiz/results', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                devoirId: assignmentId,
                score: score,
                totalQuestions: currentQuestions.length,
                correctAnswers: correctCount,
                incorrectAnswers: incorrectCount,
                mode: quizMode
            })
        });
    } catch (error) {
        console.error('Saving the quiz results failed:', error);
    }
}

function restartQuiz() {
    clearProgress();
    document.getElementById('resume-notice').style.display = 'none';
    document.getElementById('result-card').classList.remove('show');
    document.getElementById('mode-selector').style.display = 'block';
    answeredQuestions.clear();
    answersHistory = {};
    score = 0;
    correctCount = 0;
    incorrectCount = 0;
    updateStats();
}

function goBack() {
    window.location.href = '/dashboard';
}

/**
 * Loads the user identity, used by the resume key and the header menu. Without
 * it (network error...), the quiz still resumes, under an anonymous key.
 */
async function loadUserInfo() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            userId = data.userId ?? null;
            resolveUserReady();
            setHeaderUser(data);
        }
    } catch (error) {
        console.error('Loading the user info failed:', error);
    } finally {
        resolveUserReady();
    }
}

function hideLoadingScreen() {
    const ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
    mountHeader({ page: 'quiz' });
    await Promise.all([loadQuizData(), loadUserInfo()]);
    hideLoadingScreen();
});

window.startQuiz = startQuiz;
window.showAnswer = showAnswer;
window.evaluateAnswer = evaluateAnswer;
window.previousQuestion = previousQuestion;
window.validateAnswer = validateAnswer;
window.nextQuestion = nextQuestion;
window.restartQuiz = restartQuiz;
window.abandonQuiz = abandonQuiz;
window.goBack = goBack;
