require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { convertToPDF } = require('./fileConverter');

/**
 * Extraire le texte d'un fichier PDF
 */
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    
    // pdf-parse 2 : classe PDFParse ; getText() retourne { text: "..." }, destroy() libère le document
    const parser = new PDFParse({ data: dataBuffer });
    let text = '';
    try {
      const data = await parser.getText();
      text = data.text || '';
    } finally {
      await parser.destroy();
    }
    
    // Nettoyer et vérifier le texte
    const cleanText = text.trim();
    
    if (!cleanText || cleanText.length < 100) {
      console.warn(`⚠️ PDF "${path.basename(filePath)}" contient peu ou pas de texte extractible (${cleanText.length} caractères)`);
      return '';
    }
    
    console.log(`✓ PDF "${path.basename(filePath)}" : ${cleanText.length} caractères extraits`);
    return cleanText;
  } catch (error) {
    console.error(`❌ Erreur extraction PDF "${path.basename(filePath)}":`, error.message);
    return '';
  }
}

/**
 * Prompt de génération. Un seul pour la première génération comme pour les
 * compléments : seul le début change quand des questions existent déjà. Le format
 * de la réponse n'y est pas décrit, il est imposé par QUIZ_SCHEMA.
 * @param {{min: number, max: number}} range - Nombre de questions demandé pour cet appel
 * @param {Array<{question: string}>} existing - Questions déjà générées, à ne pas répéter
 */
function createPrompt(devoir, documentsText, { min, max }, existing = []) {
  const introduction = existing.length === 0
    ? `Tu es un assistant pédagogique expert. Tu dois générer un questionnaire pour aider les étudiants à RÉVISER le COURS en vue d'une ÉVALUATION.`
    : `Tu es un assistant pédagogique expert. Tu as déjà généré ${existing.length} questions pour un questionnaire de RÉVISION du COURS, il en faut PLUS : génère de NOUVELLES questions, différentes de celles-ci (sans les répéter, même reformulées) :
${existing.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}`;

  return `${introduction}

🎯 OBJECTIF DU QCM :
Réviser les connaissances et concepts du COURS afin de se préparer à une évaluation.
Les documents fournis peuvent être :
- Des COURS (support principal de révision)
- Des TRAVAUX PRATIQUES (TPs) qui illustrent l'application des concepts du cours

CONTEXTE DU DEVOIR :
- Titre : ${devoir.titre}
- Matière : ${devoir.matiere_nom || 'Non spécifiée'}
- Description : ${devoir.description || 'Non spécifiée'}
- Date : ${devoir.date || 'Non spécifiée'}

DOCUMENTS DU DEVOIR :
${documentsText}

INSTRUCTIONS :
- Génère entre ${min} et ${max} questions pour RÉVISER le COURS, basées sur les CONCEPTS et CONNAISSANCES du COURS présents dans les documents
- Couvre les concepts importants, avec des questions variées (faciles : 30%, moyennes : 50%, difficiles : 20%)
- Teste la COMPRÉHENSION et la capacité à APPLIQUER les concepts, pas la mémorisation

⚠️ RÈGLES CONCERNANT LES TPs :
- Les TPs servent UNIQUEMENT à repérer les concepts importants : pose des questions de COURS
- NE POSE JAMAIS de questions du type "Dans le TP2, quelle est..." ou "Selon le TP...", ni sur ce qui a été fait dans tel ou tel TP

❌ À IGNORER :
- Les connaissances générales non présentes dans les documents
- Le document lui-même : version, auteur, format, structure, métadonnées, copyright, pages de couverture, tables des matières

💻 QUESTIONS SUR DU CODE :
- Si les documents contiennent du code, pose des questions dessus : ce qu'un extrait de code retourne ou affiche, son comportement, les erreurs à repérer, la syntaxe
- Écris tes propres extraits de code (pas ceux des TPs)
- L'extrait de code se met dans l'énoncé de la question : jamais dans le champ "example", que l'étudiant ne voit qu'après avoir répondu
- Tout code, dans les questions, les réponses ou les explications, s'écrit entre ''' ''' : il est affiché avec coloration syntaxique
- CHAQUE QUESTION SE SUFFIT À ELLE-MÊME : l'étudiant n'a ni le cours ni les TPs sous les yeux. Une question sur un Dockerfile, un fichier ou une commande contient son contenu en entier dans l'énoncé. Sans extrait à montrer, pose une question générale qui ne le désigne pas. Bon : "Quelle instruction définit l'image de base d'un Dockerfile ?" ou "Que fait ce Dockerfile ? '''FROM node COPY . /app'''". Mauvais : "Que fait ce Dockerfile ?" sans le Dockerfile.

⚠️ RÈGLES POUR LES RÉPONSES :
- 4 options par question, dont UNE SEULE correcte
- Toutes les options ont une longueur approximativement égale (à 10-20% près)
- Inclus des QUESTIONS PIÈGES : des mauvaises réponses plausibles, basées sur des erreurs de compréhension courantes, certaines ressemblant à la bonne (ex : "ça marche" vs "ça ne marche pas")
- Évite les réponses évidentes comme "Aucune de ces réponses" ou "Toutes les réponses"
- Les options sont affichées dans un ORDRE ALÉATOIRE : ne référence JAMAIS leur position (A, B, C, D, 1, 2, 3, 4, "la deuxième option") dans la question ou l'explication
- L'explication, claire et basée sur le COURS, désigne la bonne réponse par son CONTENU ("Paris est correct car..."), pas par sa position

⚠️ RÈGLES POUR LE CHAMP "example" :
- Affiché UNIQUEMENT APRÈS que l'étudiant a répondu : il montre une application ou une utilisation du concept, quand c'est pertinent
- Il n'est jamais le code de la question ni une partie de la question`;
}

/**
 * Schéma de la réponse, imposé au modèle par décodage contraint (Claude :
 * output_config.format, Groq : response_format strict). Le JSON reçu est donc
 * toujours syntaxiquement valide et du bon type, sans texte autour.
 *
 * C'est la seule description du format : les prompts n'en répètent rien.
 *
 * Limites communes aux deux fournisseurs : tous les champs sont obligatoires et
 * les objets fermés (additionalProperties: false), pas de minimum/maximum ni de
 * maxItems, et minItems seulement à 0 ou 1. Le nombre d'options (4) ne peut donc
 * pas être imposé par le schéma : keepValidQuestions le vérifie.
 * L'enveloppe { questions } est nécessaire, la racine doit être un objet.
 */
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'Énoncé de la question, avec le code entre \'\'\' \'\'\' si elle y renvoie' },
    options: { type: 'array', items: { type: 'string' }, description: 'Exactement 4 réponses possibles' },
    correct: { type: 'integer', enum: [0, 1, 2, 3], description: 'Indice (0 à 3) de la seule bonne réponse dans options' },
    explanation: { type: 'string', description: 'Explication de la bonne réponse' },
    example: { type: 'string', description: "Exemple d'application du concept, affiché à l'élève seulement après qu'il a répondu ; chaîne vide s'il n'y en a pas ; jamais le code ni une partie de la question" }
  },
  required: ['question', 'options', 'correct', 'explanation', 'example'],
  additionalProperties: false
};

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: QUESTION_SCHEMA, description: 'Les questions du quiz' }
  },
  required: ['questions'],
  additionalProperties: false
};

// Questions demandées par appel, selon ce que la réponse peut contenir. Claude a
// 16000 tokens de sortie. Groq en a 4096, partagés avec le raisonnement de
// gpt-oss, et l'offre gratuite plafonne à 8000 tokens par minute en tout
// (document compris) : on n'y demande que ce qui tient, sans minimum de 20 par
// appel. La boucle de génération enchaîne les appels jusqu'au total voulu.
const QUESTIONS_PAR_APPEL = {
  claude: { min: 20, max: 100 },
  groq: { min: 8, max: 12 }
};

/**
 * Générer un quiz avec Claude (Premium)
 */
async function generateWithClaude(prompt) {
  const apiKey = process.env.PREMIUM_API_KEY;
  
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('PREMIUM_API_KEY n\'est pas configurée dans les variables d\'environnement');
  }
  
  const client = new Anthropic({
    apiKey: apiKey
  });

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      output_config: {
        format: { type: 'json_schema', schema: QUIZ_SCHEMA }
      }
    });

    // Un refus ne respecte pas le schéma : rien à récupérer, Groq prend le relais
    if (message.stop_reason === 'refusal') {
      const refusal = new Error('Claude a refusé de générer ce quiz');
      refusal.refusal = true;
      throw refusal;
    }

    const content = message.content.find(block => block.type === 'text')?.text ?? '';
    return parseQuestions(content, message.stop_reason === 'max_tokens');
  } catch (error) {
    console.error('❌ Erreur détaillée Claude:', {
      status: error.status,
      message: error.message,
      type: error.type,
      body: error.body
    });
    throw error;
  }
}

/**
 * Générer un quiz avec Groq (Gratuit)
 */
async function generateWithGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('GROQ_API_KEY n\'est pas configurée dans les variables d\'environnement');
  }
  
  const client = new Groq({
    apiKey: apiKey
  });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'quiz_questions', strict: true, schema: QUIZ_SCHEMA }
      }
    });
  } catch (error) {
    const recovered = questionsFromGroqError(error);
    if (!recovered) throw error;
    return recovered;
  }

  const choice = completion.choices[0];
  return parseQuestions(choice.message.content ?? '', choice.finish_reason === 'length');
}

/**
 * Groq valide lui-même le JSON contre le schéma : quand le modèle génère quelque
 * chose d'invalide (une question à laquelle il manque un champ, une réponse
 * coupée...), il répond une erreur 400 qui contient ce qui a été généré dans
 * `failed_generation`. On en récupère les questions valides.
 * @returns {Array|null} Null si l'erreur n'en contient aucune
 */
function questionsFromGroqError(error) {
  if (error?.status !== 400) return null;
  const failed = error.error?.error?.failed_generation ?? error.error?.failed_generation;
  if (typeof failed !== 'string' || !failed) return null;

  try {
    const questions = parseQuestions(failed, true);
    console.warn(`⚠️ Groq a refusé sa propre réponse (${error.message.slice(0, 120)}) : ${questions.length} question(s) valide(s) récupérée(s)`);
    return questions;
  } catch {
    return null;
  }
}

/**
 * Questions complètes d'un JSON coupé en route. Le décodage contraint garantit un
 * JSON valide, pas qu'il soit complet : quand la réponse s'arrête sur la limite de
 * tokens, on garde les questions entières plutôt que de tout perdre.
 */
function completeQuestionsOfTruncatedJson(text) {
  const start = text.indexOf('[');
  if (start === -1) return [];

  const questions = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let itemStart = -1;

  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) itemStart = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && itemStart !== -1) {
        try {
          questions.push(JSON.parse(text.slice(itemStart, i + 1)));
        } catch {
          // Question abîmée : ignorée
        }
        itemStart = -1;
      }
    }
  }
  return questions;
}

/**
 * Lire la réponse du modèle : { questions: [...] }. Les
 * questions invalides sont écartées une à une (keepValidQuestions), une seule ne
 * fait plus perdre toute la série.
 * @param {string} text - Réponse du modèle
 * @param {boolean} truncated - Réponse incomplète (limite de tokens, rejet de Groq)
 * @throws {Error} Si aucune question valide n'en ressort
 */
function parseQuestions(text, truncated = false) {
  let questions;
  try {
    questions = JSON.parse(text)?.questions;
  } catch {
    if (!truncated) throw new Error('Format JSON invalide dans la réponse');
    questions = completeQuestionsOfTruncatedJson(text);
  }

  if (truncated) {
    console.warn(`⚠️ Réponse incomplète : ${Array.isArray(questions) ? questions.length : 0} question(s) complète(s) récupérée(s)`);
  }

  const valid = keepValidQuestions(questions);
  if (valid.length === 0) {
    throw new Error(truncated ? 'Réponse incomplète, aucune question complète' : 'Aucune question valide dans la réponse');
  }
  return valid;
}

/**
 * Détecter une question qui renvoie à un code (« ce Dockerfile », « le code
 * ci-dessous »...) sans l'inclure : l'étudiant n'aurait rien à analyser.
 * Seuls les démonstratifs (ce, cette...) et « suivant / ci-dessous » comptent :
 * « la commande pour lister les conteneurs » est une question de cours.
 */
const OBJETS_CODE = String.raw`code|dockerfile|script|extrait|fichier|commande|configuration|pipeline|requête|snippet|programme|pom|\.?gitlab-ci(?:\.ya?ml)?|ya?ml|compose|makefile`;
const REFERENCE_CODE = new RegExp(
  String.raw`\b(?:ce|cet|cette|ces)\s+(?:${OBJETS_CODE})\b|\b(?:${OBJETS_CODE})\s+(?:suivante?s?|ci-dessous|ci-dessus)`,
  'i'
);
// Bloc ''' ''' ou ``` ```, ou code en ligne entre accents graves
const BLOC_CODE = /'''[\s\S]*?'''|```[\s\S]*?```|`[^`\n]+`/;

function referencesMissingCode(q) {
  return REFERENCE_CODE.test(q.question) && !BLOC_CODE.test(q.question);
}

/**
 * Questions bien formées parmi celles reçues (le schéma garantit les types, pas
 * le nombre d'options ni les textes vides). Les autres sont écartées et journalisées.
 */
function keepValidQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  const isText = (value) => typeof value === 'string' && value.trim() !== '';
  const valid = questions.filter((q, index) => {
    const problem = !q || typeof q !== 'object' ? 'question absente'
      : !isText(q.question) ? 'champ "question" vide'
      : !Array.isArray(q.options) || q.options.length !== 4 ? 'il faut exactement 4 options'
      : !q.options.every(isText) ? 'option vide'
      : !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3 ? 'indice de réponse correcte invalide'
      : !isText(q.explanation) ? 'champ "explanation" vide'
      : null;
    if (problem) console.warn(`⚠️ Question ${index + 1} écartée : ${problem}`);
    return !problem;
  });

  // L'exemple est facultatif : le schéma impose le champ, vide quand il n'y en a pas
  return valid.map(q => ({ ...q, example: typeof q.example === 'string' ? q.example : '' }));
}

/**
 * Claude passe la main à Groq quand il ne peut pas répondre : refus de contenu,
 * ou erreur 400 (crédit épuisé...). Un schéma refusé n'en fait pas partie : ce
 * serait une erreur de code, qui enverrait en silence tous les utilisateurs
 * premium sur Groq. Elle remonte telle quelle et n'est pas réessayée.
 */
function shouldFallbackToGroq(error) {
  if (error.refusal) return true;
  if (error.status !== 400) return false;

  if (/output_config|json_schema|schema|grammar/i.test(error.message)) {
    console.error('❌ Schéma de sortie refusé par Claude, pas de repli sur Groq :', error.message);
    error.noRetry = true;
    return false;
  }
  return true;
}

/**
 * Un appel de génération : Claude pour les classes premium, Groq sinon ou en
 * repli. Le prompt est construit pour le fournisseur qui répond, car le nombre
 * de questions demandé dépend de sa limite de sortie.
 * @param {(range: {min: number, max: number}) => string} buildPrompt
 * @param {{premium: boolean, fallback: boolean}} provider - fallback passe à true quand Claude est écarté
 */
async function generateBatch(buildPrompt, provider) {
  if (provider.premium && !provider.fallback) {
    try {
      return await generateWithClaude(buildPrompt(QUESTIONS_PAR_APPEL.claude));
    } catch (error) {
      if (!shouldFallbackToGroq(error)) throw error;
      console.warn(`⚠️ Claude écarté (${error.message.slice(0, 120)}), basculement vers Groq (gratuit)...`);
      provider.fallback = true;
    }
  }
  return generateWithGroq(buildPrompt(QUESTIONS_PAR_APPEL.groq));
}

/**
 * Générer avec retry jusqu'à avoir 20 questions
 */
async function generate_with_retry(devoir, isPremium, documentsText) {
  const MAX_RETRIES = 5;
  const MIN_QUESTIONS = 20;
  let allQuestions = [];
  let attempts = 0;
  const provider = { premium: isPremium, fallback: false }; // fallback : Claude écarté, Groq prend le relais

  console.log(`🎯 Objectif: ${MIN_QUESTIONS} questions minimum`);
  console.log(`🤖 Mode: ${isPremium ? 'Premium (Claude)' : 'Gratuit (Groq)'}`);

  while (attempts < MAX_RETRIES && allQuestions.length < MIN_QUESTIONS) {
    attempts++;
    
    try {
      let newQuestions;

      if (allQuestions.length === 0) {
        // Première tentative : prompt normal
        console.log(`📝 Tentative ${attempts}/${MAX_RETRIES} - Génération initiale...`);
        newQuestions = await generateBatch(range => createPrompt(devoir, documentsText, range), provider);
      } else {
        // Tentatives suivantes : même prompt, avec les questions déjà générées à ne pas répéter
        console.log(`📝 Tentative ${attempts}/${MAX_RETRIES} - Demande de questions supplémentaires...`);
        newQuestions = await generateBatch(range => createPrompt(devoir, documentsText, range, allQuestions), provider);
      }

      // Écarter les questions qui parlent d'un code absent
      const avantFiltre = newQuestions.length;
      newQuestions = newQuestions.filter(q => !referencesMissingCode(q));
      if (newQuestions.length < avantFiltre) {
        console.warn(`⚠️ ${avantFiltre - newQuestions.length} question(s) écartée(s) : elles renvoient à un code absent`);
      }

      // Ajouter les nouvelles questions
      allQuestions = allQuestions.concat(newQuestions);
      
      console.log(`✓ ${newQuestions.length} questions générées (Total: ${allQuestions.length}/${MIN_QUESTIONS})`);
      
      // Si on a atteint le minimum, on arrête
      if (allQuestions.length >= MIN_QUESTIONS) {
        console.log(`✅ Objectif atteint: ${allQuestions.length} questions`);
        break;
      }
      
    } catch (error) {
      console.error(`❌ Tentative ${attempts} échouée:`, error.message);

      // Inutile de réessayer une erreur qui reviendra à l'identique
      if (error.noRetry) throw error;
      
      // Si c'est la dernière tentative et qu'on n'a pas assez de questions
      if (attempts >= MAX_RETRIES && allQuestions.length < MIN_QUESTIONS) {
        throw new Error(`Impossible de générer 20 questions après ${MAX_RETRIES} tentatives. Seulement ${allQuestions.length} questions générées.`);
      }
    }
  }

  // Vérification finale
  if (allQuestions.length < MIN_QUESTIONS) {
    throw new Error(`Impossible de générer ${MIN_QUESTIONS} questions après ${MAX_RETRIES} tentatives. Seulement ${allQuestions.length} questions générées.`);
  }

  return allQuestions;
}

/**
 * Fonction principale pour générer un quiz
 */
async function generateQuizWithAI(devoir, isPremium, fichiers) {
  // Extraire le texte de tous les documents
  const uploadsDir = path.join(__dirname, '../uploads');
  const documentsTexts = [];
  
  console.log(`📄 Extraction de ${fichiers.length} document(s)...`);

  for (const fichier of fichiers) {
    let filePath = path.join(uploadsDir, fichier.filename);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Fichier non trouvé : ${filePath}`);
      continue;
    }

    // Convertir en PDF si nécessaire (DOCX, PPTX, etc.)
    try {
      filePath = await convertToPDF(filePath);
    } catch (error) {
      console.error(`❌ Erreur conversion : ${error.message}`);
      continue;
    }

    // Extraire le texte du PDF
    const text = await extractTextFromPDF(filePath);
    if (text) {
      documentsTexts.push(text);
    }
  }

  if (documentsTexts.length === 0) {
    throw new Error('Impossible d\'extraire le texte des documents. Les PDFs sont peut-être vides, protégés ou contiennent uniquement des images.');
  }

  const documentsText = documentsTexts.join('\n\n--- DOCUMENT SUIVANT ---\n\n');
  const totalChars = documentsText.length;
  
  console.log(`📊 Contenu extrait : ${totalChars} caractères au total`);
  
  // Vérifier qu'il y a suffisamment de contenu
  if (totalChars < 500) {
    throw new Error('Le contenu des documents est insuffisant pour générer un quiz. Les documents doivent contenir au moins 500 caractères de texte extractible.');
  }

  // Générer avec retry jusqu'à avoir 20 questions
  const questions = await generate_with_retry(devoir, isPremium, documentsText);
  
  console.log(`🎉 Quiz généré avec succès: ${questions.length} questions`);
  
  return questions;
}

module.exports = {
  generateQuizWithAI,
  extractTextFromPDF,
  referencesMissingCode,
  // Pour les tests
  createPrompt,
  parseQuestions,
  keepValidQuestions,
  questionsFromGroqError,
  shouldFallbackToGroq,
  QUIZ_SCHEMA
};
