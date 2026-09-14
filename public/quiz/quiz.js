import {escapeHTML} from "../js/utils/dom.js";

// Variables globales
let quizData = null;
let currentQuestions = [];
let currentQuestionIndex = 0;
let selectedOption = null;
let score = 0;
let correctCount = 0;
let incorrectCount = 0;
let answered = false;
let quizMode = null;
let answeredQuestions = new Set(); // Pour empêcher la modification des anciennes réponses
let answersHistory = {}; // Stocker l'historique des réponses {questionIndex: {selectedOption, isCorrect, mode}}
let devoirId = null;

// Fonction pour formater le texte avec des blocs de code
function formatTextWithCode(text) {
    if (!text) return '';

    // Remplacer '''code''' par des blocs de code HTML avec coloration syntaxique
    // Support pour ''' (3 apostrophes) et ``` (3 backticks)
    let result = escapeHTML(text);

    function replacer(match, code) {
      return `<pre><code>${code.trim()}</code></pre>`;
    }

    // Remplacer '''code''' (3 apostrophes simples)
    result = result.replace(/'''([\s\S]*?)'''/g, replacer);
    // Remplacer ```code``` (3 backticks) au cas où
    result = result.replace(/```([\s\S]*?)```/g, replacer);

    return result;
}

// Récupérer l'ID du devoir depuis l'URL
function getDevoirIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// Charger les données du quiz depuis le backend
async function loadQuizData() {
    try {
        devoirId = getDevoirIdFromUrl();
        if (!devoirId) {
            alert('Aucun quiz spécifié');
            window.location.href = '/dashboard';
            return;
        }

        const response = await fetch(`/api/quiz/${devoirId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Erreur lors du chargement du quiz');
        }

        quizData = await response.json();

        // Mettre à jour le titre
        document.getElementById('quizTitle').textContent = quizData.titre || 'Quiz';

        // Afficher le sélecteur de mode
        document.getElementById('modeSelector').style.display = 'block';

        // Si le quiz n'autorise qu'un mode, le démarrer directement
        if (quizData.mode === 'choice') {
            startQuiz('choice');
        } else if (quizData.mode === 'oral') {
            startQuiz('oral');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Impossible de charger le quiz');
        window.location.href = '/dashboard';
    }
}

// Démarrer le quiz
function startQuiz(mode) {
    quizMode = mode;
    currentQuestions = quizData.questions || [];

    if (currentQuestions.length === 0) {
        alert('Ce quiz ne contient aucune question');
        return;
    }

    // Mélanger les questions
    currentQuestions = shuffleArray(currentQuestions);
    currentQuestionIndex = 0;
    score = 0;
    correctCount = 0;
    incorrectCount = 0;
    answeredQuestions.clear();

    updateStats();
    document.getElementById('modeSelector').style.display = 'none';
    document.getElementById('progressBar').style.display = 'block';
    document.getElementById('quizCard').style.display = 'block';

    loadQuestion();
}

// Mélanger un tableau
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Charger une question
function loadQuestion() {
    // Vérifier si la question a déjà été répondue
    const isAlreadyAnswered = answeredQuestions.has(currentQuestionIndex);
    answered = isAlreadyAnswered;
    selectedOption = null;

    const question = currentQuestions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / currentQuestions.length) * 100;    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('questionNumber').textContent =
        `Question ${currentQuestionIndex + 1} sur ${currentQuestions.length}`;
    document.getElementById('question').innerHTML = formatTextWithCode(question.question);

    document.getElementById('explanation').classList.remove('show');
    document.getElementById('options').style.display = 'none';
    document.getElementById('oralResponse').style.display = 'none';
    document.getElementById('validateBtn').style.display = 'none';
    document.getElementById('nextBtn').style.display = 'none';

    const existingRecap = document.getElementById('recapDiv');
    if (existingRecap) {
        existingRecap.remove();
    }

    if (quizMode === 'choice') {
        document.getElementById('options').style.display = 'flex';

        if (!isAlreadyAnswered) {
            document.getElementById('validateBtn').style.display = 'inline-block';
        } else {
            document.getElementById('nextBtn').style.display = 'inline-block';
        }

        const optionsContainer = document.getElementById('options');
        optionsContainer.innerHTML = '';

        // Créer un tableau d'options mélangées avec leur index original
        const shuffledOptions = question.options.map((option, index) => ({
            text: option,
            originalIndex: index
        }));

        // Mélanger les options seulement si pas déjà répondu
        if (!isAlreadyAnswered && !question.shuffledOptions) {
            question.shuffledOptions = shuffleArray(shuffledOptions);
        } else if (!question.shuffledOptions) {
            question.shuffledOptions = shuffledOptions;
        }

        question.shuffledOptions.forEach((option, displayIndex) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'option';

            // Si déjà répondu, empêcher la sélection
            if (!isAlreadyAnswered) {
                optionDiv.onclick = () => selectOption(displayIndex);
            } else {
                optionDiv.style.cursor = 'not-allowed';
                optionDiv.style.opacity = '0.7';
            }
            const letter = String.fromCharCode(65 + displayIndex);
            optionDiv.innerHTML = `
                <div class="option-letter">${escapeHTML(letter)}</div>
                <div class="option-text">${formatTextWithCode(option.text)}</div>
            `;

            optionsContainer.appendChild(optionDiv);
        });

        // Restaurer l'état si déjà répondu
        if (isAlreadyAnswered && answersHistory[currentQuestionIndex]) {
            const history = answersHistory[currentQuestionIndex];
            const options = document.querySelectorAll('.option');
            
            // Trouver la position affichée de la bonne réponse
            const correctDisplayIndex = question.shuffledOptions.findIndex(
                opt => opt.originalIndex === question.correct
            );

            // Marquer l'option sélectionnée
            if (history.isCorrect) {
                options[history.selectedOption].classList.add('correct');
            } else {
                options[history.selectedOption].classList.add('incorrect');
                options[correctDisplayIndex].classList.add('correct');
            }

            // Afficher l'explication
            if (question.explanation) {
                document.getElementById('explanationText').innerHTML = formatTextWithCode(question.explanation);
                if (question.example) {
                    document.getElementById('exampleText').innerHTML = formatTextWithCode(question.example);
                    document.getElementById('example').style.display = 'block';
                } else {
                    document.getElementById('example').style.display = 'none';
                }
                document.getElementById('explanation').classList.add('show');
            }
        }
    } else {
        document.getElementById('oralResponse').style.display = 'block';

        if (!isAlreadyAnswered) {
            document.getElementById('showAnswerBtn').style.display = 'inline-block';
        } else {
            document.getElementById('showAnswerBtn').style.display = 'none';
            document.getElementById('nextBtn').style.display = 'inline-block';
        }

        document.getElementById('selfEvaluation').style.display = 'none';
        document.getElementById('correctAnswer').style.display = 'none';
        document.getElementById('correctAnswer').innerHTML = '';

        // Restaurer l'état si déjà répondu (mode oral)
        if (isAlreadyAnswered && answersHistory[currentQuestionIndex]) {
            const history = answersHistory[currentQuestionIndex];
              // Afficher la réponse correcte
            const correctAnswerDiv = document.getElementById('correctAnswer');
            correctAnswerDiv.innerHTML = `<strong>Réponse correcte:</strong> ${formatTextWithCode(question.options[question.correct])}`;
            correctAnswerDiv.style.display = 'block';

            // Afficher l'auto-évaluation (désactivée)
            document.getElementById('selfEvaluation').style.display = 'block';
            const evalButtons = document.querySelectorAll('.eval-buttons button');
            evalButtons.forEach(btn => btn.disabled = true);            // Afficher l'explication
            if (question.explanation) {
                document.getElementById('explanationText').innerHTML = formatTextWithCode(question.explanation);
                if (question.example) {
                    document.getElementById('exampleText').innerHTML = formatTextWithCode(question.example);
                    document.getElementById('example').style.display = 'block';
                } else {
                    document.getElementById('example').style.display = 'none';
                }
                document.getElementById('explanation').classList.add('show');
            }

            // Restaurer le récap si la réponse était incorrecte
            if (!history.isCorrect) {
                const recapDiv = document.createElement('div');
                recapDiv.id = 'recapDiv';
                recapDiv.className = 'recap';
                recapDiv.innerHTML = `
                    <strong>Récapitulatif:</strong>
                    <p>${formatTextWithCode(question.question)}</p>
                    <p><strong>Réponse:</strong> ${formatTextWithCode(question.options[question.correct])}</p>
                    ${question.explanation ? `<p>${formatTextWithCode(question.explanation)}</p>` : ''}
                `;
                const correctAnswerDiv = document.getElementById('correctAnswer');
                correctAnswerDiv.parentNode.insertBefore(recapDiv, correctAnswerDiv.nextSibling);
            }
        }
    }

    // Gérer l'affichage du bouton précédent
    document.getElementById('prevBtn').disabled = currentQuestionIndex === 0;
}

// Sélectionner une option
function selectOption(index) {
    if (answered || answeredQuestions.has(currentQuestionIndex)) return;

    const options = document.querySelectorAll('.option');
    options.forEach(opt => opt.classList.remove('selected'));
    options[index].classList.add('selected');
    selectedOption = index;
}

// Valider la réponse (mode choix multiple)
function validateAnswer() {
    if (selectedOption === null || answered || answeredQuestions.has(currentQuestionIndex)) return;

    answered = true;
    answeredQuestions.add(currentQuestionIndex);

    const question = currentQuestions[currentQuestionIndex];
    const options = document.querySelectorAll('.option');

    // Désactiver toutes les options
    options.forEach(opt => {
        opt.style.cursor = 'not-allowed';
        opt.onclick = null;
    });

    // Vérifier si l'option sélectionnée correspond à la bonne réponse originale
    const selectedOriginalIndex = question.shuffledOptions[selectedOption].originalIndex;
    const isCorrect = selectedOriginalIndex === question.correct;

    // Trouver la position affichée de la bonne réponse
    const correctDisplayIndex = question.shuffledOptions.findIndex(
        opt => opt.originalIndex === question.correct
    );

    // Sauvegarder dans l'historique
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

    // Afficher l'explication si elle existe
    if (question.explanation) {
        document.getElementById('explanationText').innerHTML = formatTextWithCode(question.explanation);
        if (question.example) {
            document.getElementById('exampleText').innerHTML = formatTextWithCode(question.example);
            document.getElementById('example').style.display = 'block';
        } else {
            document.getElementById('example').style.display = 'none';
        }
        document.getElementById('explanation').classList.add('show');
    }

    updateStats();

    document.getElementById('validateBtn').style.display = 'none';
    document.getElementById('nextBtn').style.display = 'inline-block';
}

// Afficher la réponse (mode oral)
function showAnswer() {
    if (answered || answeredQuestions.has(currentQuestionIndex)) return;

    const question = currentQuestions[currentQuestionIndex];
    answered = true;

    const correctAnswerDiv = document.getElementById('correctAnswer');
    correctAnswerDiv.innerHTML = `<strong>Réponse correcte:</strong> ${formatTextWithCode(question.options[question.correct])}`;
    correctAnswerDiv.style.display = 'block';

    document.getElementById('selfEvaluation').style.display = 'block';
    document.getElementById('showAnswerBtn').style.display = 'none';

    // Afficher l'explication si elle existe
    if (question.explanation) {
        document.getElementById('explanationText').innerHTML = formatTextWithCode(question.explanation);
        if (question.example) {
            document.getElementById('exampleText').innerHTML = formatTextWithCode(question.example);
            document.getElementById('example').style.display = 'block';
        } else {
            document.getElementById('example').style.display = 'none';
        }
        document.getElementById('explanation').classList.add('show');
    }

    const evalButtons = document.querySelectorAll('.eval-buttons button');
    evalButtons.forEach(btn => btn.disabled = false);
}

// Évaluer la réponse (mode oral)
function evaluateAnswer(isCorrect) {
    if (answeredQuestions.has(currentQuestionIndex)) return;

    answeredQuestions.add(currentQuestionIndex);

    // Sauvegarder dans l'historique
    answersHistory[currentQuestionIndex] = {
        selectedOption: null, // Pas d'option sélectionnée en mode oral
        isCorrect: isCorrect,
        mode: 'oral'
    };

    const existingRecap = document.getElementById('recapDiv');
    if (existingRecap) {
        existingRecap.remove();
    }

    if (isCorrect) {
        score += 10;
        correctCount++;
    } else {
        incorrectCount++;

        const question = currentQuestions[currentQuestionIndex];        const recapDiv = document.createElement('div');
        recapDiv.id = 'recapDiv';
        recapDiv.className = 'recap';
        recapDiv.innerHTML = `
            <strong>Récapitulatif:</strong>
            <p>${formatTextWithCode(question.question)}</p>
            <p><strong>Réponse:</strong> ${formatTextWithCode(question.options[question.correct])}</p>
            ${question.explanation ? `<p>${formatTextWithCode(question.explanation)}</p>` : ''}
        `;

        const correctAnswerDiv = document.getElementById('correctAnswer');
        correctAnswerDiv.parentNode.insertBefore(recapDiv, correctAnswerDiv.nextSibling);
    }

    updateStats();

    const evalButtons = document.querySelectorAll('.eval-buttons button');
    evalButtons.forEach(btn => btn.disabled = true);

    document.getElementById('nextBtn').style.display = 'inline-block';
}

// Question suivante
function nextQuestion() {
    if (currentQuestionIndex < currentQuestions.length - 1) {
        currentQuestionIndex++;
        loadQuestion();
    } else {
        showResults();
    }
}

// Question précédente
function previousQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        loadQuestion();
    }
}

// Mettre à jour les statistiques
function updateStats() {
    document.getElementById('score').textContent = score;
    document.getElementById('correct').textContent = correctCount;
    document.getElementById('incorrect').textContent = incorrectCount;
}

// Afficher les résultats
async function showResults() {
    document.getElementById('quizCard').style.display = 'none';
    document.getElementById('progressBar').style.display = 'none';

    const percentage = Math.round((correctCount / currentQuestions.length) * 100);
    document.getElementById('finalScore').textContent = percentage + '%';

    let message = '';
    if (percentage >= 90) {
        message = '🌟 Excellent ! Vous maîtrisez parfaitement le sujet !';
    } else if (percentage >= 70) {
        message = '👍 Très bien ! Vous avez de bonnes connaissances !';
    } else if (percentage >= 50) {
        message = '👌 Pas mal ! Continuez à vous entraîner !';
    } else {
        message = '💪 Il faut réviser un peu plus ! Ne baissez pas les bras !';
    }

    document.getElementById('resultMessage').textContent = message;
    document.getElementById('resultCard').classList.add('show');

    // Sauvegarder les résultats
    try {
        await fetch('/api/quiz/results', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                devoirId: devoirId,
                score: score,
                totalQuestions: currentQuestions.length,
                correctAnswers: correctCount,
                incorrectAnswers: incorrectCount,
                mode: quizMode
            })
        });
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des résultats:', error);
    }
}

// Recommencer le quiz
function restartQuiz() {
    document.getElementById('resultCard').classList.remove('show');
    document.getElementById('modeSelector').style.display = 'block';
    answeredQuestions.clear();
    answersHistory = {};
    score = 0;
    correctCount = 0;
    incorrectCount = 0;
    updateStats();
}

// Retour au dashboard
function goBack() {
    window.location.href = '/dashboard';
}

// Gestion du menu utilisateur
async function loadUserInfo() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            const eleveInfo = document.getElementById('eleve-info');
            if (eleveInfo) {
                eleveInfo.textContent = data.username || data.email;
            }

            // Charger les paramètres pour l'emploi du temps
            const settingsResponse = await fetch('/api/devoirs/settings/emploi-temps', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (settingsResponse.ok) {
                const settings = await settingsResponse.json();
                if (settings.lien) {
                    const emploiTempsBtn = document.getElementById('emploi-temps-btn');
                    if (emploiTempsBtn) {
                        emploiTempsBtn.classList.remove('hidden');
                        emploiTempsBtn.onclick = () => {
                            window.open(settings.lien, '_blank');
                            // Fermer le dropdown après le clic
                            document.getElementById('user-dropdown').classList.add('hidden');
                        };
                    }
                } else {
                    const emploiTempsBtn = document.getElementById('emploi-temps-btn');
                    if (emploiTempsBtn) {
                        emploiTempsBtn.classList.add('hidden');
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des infos utilisateur:', error);
    }
}

// Le theme lui-meme est deja applique par /js/theme-init.js avant le premier rendu,
// il ne reste qu'a synchroniser le bouton du menu.
function loadThemePreference() {
    updateThemeButton(document.documentElement.classList.contains('dark-theme'));
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeButton(isDark);
}

function updateThemeButton(isDark) {
    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');

    if (!themeIcon || !themeText) return;

    if (isDark) {
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
        themeText.textContent = 'Theme clair';
    } else {
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
        themeText.textContent = 'Theme sombre';
    }
}

// Gestion du dropdown menu
const userMenuBtn = document.getElementById('user-menu-btn');
const userDropdown = document.getElementById('user-dropdown');
const settingsBtn = document.getElementById('settings-btn');
const notesBtn = document.getElementById('notes-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const logoutBtn = document.getElementById('logout-btn');

if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('hidden');
    });

    // Fermer le menu en cliquant ailleurs
    document.addEventListener('click', (e) => {
        if (!userDropdown.classList.contains('hidden') && !e.target.closest('.user-menu')) {
            userDropdown.classList.add('hidden');
        }
    });

    // Empêcher la fermeture en cliquant sur le menu
    userDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

// Bouton paramètres
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        window.location.href = '/settings';
    });
}

if (notesBtn) {
    notesBtn.addEventListener('click', () => {
        window.open('https://iut-notes.unice.fr', '_blank');
        if (userDropdown) {
            userDropdown.classList.add('hidden');
        }
    });
}

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}

// Bouton déconnexion
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        window.location.href = '/';
    });
}

function hideLoadingScreen() {
    const ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
}

// Initialiser le quiz au chargement de la page
document.addEventListener('DOMContentLoaded', async () => {
    loadThemePreference();
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
window.goBack = goBack;
