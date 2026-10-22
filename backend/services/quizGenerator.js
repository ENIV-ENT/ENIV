require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { convertToPdf } = require('./fileConverter');

/**
 * Extracts the text of a PDF file. Returns an empty string when there is little
 * or no extractable text (scanned document) or on error.
 * pdf-parse 2: PDFParse class; getText() returns { text: "..." }, destroy() frees the document.
 */
async function extractTextFromPdf(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);

    const parser = new PDFParse({ data: dataBuffer });
    let text = '';
    try {
      const data = await parser.getText();
      text = data.text || '';
    } finally {
      await parser.destroy();
    }

    const cleanText = text.trim();

    if (!cleanText || cleanText.length < 100) {
      console.warn(`⚠️ PDF "${path.basename(filePath)}" has little or no extractable text (${cleanText.length} characters)`);
      return '';
    }

    console.log(`✓ PDF "${path.basename(filePath)}": ${cleanText.length} characters extracted`);
    return cleanText;
  } catch (error) {
    console.error(`❌ PDF extraction failed for "${path.basename(filePath)}":`, error.message);
    return '';
  }
}

/**
 * Generation prompt, in French. A single one for the first generation and for the
 * additional ones: only the beginning changes when questions already exist. The
 * answer format is not described there, it is enforced by QUIZ_SCHEMA.
 * @param {Object} assignment - row with titre, matiere_nom, description, date
 * @param {string} documentsText
 * @param {{min: number, max: number}} range - number of questions asked for this call
 * @param {Array<{question: string}>} existing - questions already generated, not to repeat
 */
function createPrompt(assignment, documentsText, { min, max }, existing = []) {
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
- Titre : ${assignment.titre}
- Matière : ${assignment.matiere_nom || 'Non spécifiée'}
- Description : ${assignment.description || 'Non spécifiée'}
- Date : ${assignment.date || 'Non spécifiée'}

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
 * Answer schema, enforced on the model by constrained decoding (Claude:
 * output_config.format, Groq: strict response_format). The JSON received is
 * therefore always syntactically valid and of the right type, without text around.
 *
 * It is the only description of the format: the prompts repeat nothing of it.
 *
 * Limits shared by both providers: every field is required and objects are closed
 * (additionalProperties: false), no minimum/maximum or maxItems, and minItems only
 * at 0 or 1. The number of options (4) can therefore not be enforced by the
 * schema: keepValidQuestions checks it. The { questions } envelope is needed, the
 * root must be an object. The keys are also those stored in devoir_quiz.questions_json.
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

/**
 * Questions asked per call, depending on what the answer can hold. Claude has
 * 16000 output tokens. Groq has 4096, shared with the reasoning of gpt-oss, and the
 * free tier caps at 8000 tokens per minute in total (document included): only what
 * fits is asked, without a minimum of 20 per call. The generation loop chains the
 * calls until the wanted total.
 */
const QUESTIONS_PER_CALL = {
  claude: { min: 20, max: 100 },
  groq: { min: 8, max: 12 }
};

/**
 * Generates questions with Claude (premium). A refusal does not follow the
 * schema: there is nothing to recover, Groq takes over.
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

    if (message.stop_reason === 'refusal') {
      const refusal = new Error('Claude a refusé de générer ce quiz');
      refusal.refusal = true;
      throw refusal;
    }

    const content = message.content.find(block => block.type === 'text')?.text ?? '';
    return parseQuestions(content, message.stop_reason === 'max_tokens');
  } catch (error) {
    console.error('❌ Claude error details:', {
      status: error.status,
      message: error.message,
      type: error.type,
      body: error.body
    });
    throw error;
  }
}

/**
 * Generates questions with Groq (free).
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
 * Groq validates the JSON against the schema itself: when the model generates
 * something invalid (a question missing a field, a cut answer...), it answers a
 * 400 error holding what was generated in `failed_generation`. The valid questions
 * are recovered from it.
 * @returns {Array|null} null if the error holds none
 */
function questionsFromGroqError(error) {
  if (error?.status !== 400) return null;
  const failed = error.error?.error?.failed_generation ?? error.error?.failed_generation;
  if (typeof failed !== 'string' || !failed) return null;

  try {
    const questions = parseQuestions(failed, true);
    console.warn(`⚠️ Groq refused its own answer (${error.message.slice(0, 120)}): ${questions.length} valid question(s) recovered`);
    return questions;
  } catch {
    return null;
  }
}

/**
 * Complete questions of a JSON cut midway. Constrained decoding guarantees valid
 * JSON, not complete JSON: when the answer stops on the token limit, the whole
 * questions are kept rather than losing everything. A damaged question is skipped.
 */
function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
        const question = parseJsonOrNull(text.slice(itemStart, i + 1));
        if (question) questions.push(question);
        itemStart = -1;
      }
    }
  }
  return questions;
}

/**
 * Reads the model answer: { questions: [...] }. Invalid questions are dropped one
 * by one (keepValidQuestions), so a single one no longer loses the whole series.
 * @param {string} text - model answer
 * @param {boolean} truncated - incomplete answer (token limit, rejection by Groq)
 * @throws {Error} if no valid question comes out of it
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
    console.warn(`⚠️ Incomplete answer: ${Array.isArray(questions) ? questions.length : 0} complete question(s) recovered`);
  }

  const valid = keepValidQuestions(questions);
  if (valid.length === 0) {
    throw new Error(truncated ? 'Réponse incomplète, aucune question complète' : 'Aucune question valide dans la réponse');
  }
  return valid;
}

/**
 * Detects a question that refers to code ("ce Dockerfile", "le code ci-dessous"...)
 * without including it: the student would have nothing to analyze. Only French
 * demonstratives (ce, cette...) and "suivant / ci-dessous" count: "la commande pour
 * lister les conteneurs" is a course question. A code block is ''' ''' or ``` ```,
 * or inline code between backticks.
 */
const CODE_OBJECTS = String.raw`code|dockerfile|script|extrait|fichier|commande|configuration|pipeline|requête|snippet|programme|pom|\.?gitlab-ci(?:\.ya?ml)?|ya?ml|compose|makefile`;
const CODE_REFERENCE = new RegExp(
  String.raw`\b(?:ce|cet|cette|ces)\s+(?:${CODE_OBJECTS})\b|\b(?:${CODE_OBJECTS})\s+(?:suivante?s?|ci-dessous|ci-dessus)`,
  'i'
);
const CODE_BLOCK = /'''[\s\S]*?'''|```[\s\S]*?```|`[^`\n]+`/;

function referencesMissingCode(q) {
  return CODE_REFERENCE.test(q.question) && !CODE_BLOCK.test(q.question);
}

/**
 * Well-formed questions among those received (the schema guarantees the types,
 * not the number of options nor empty texts). The others are dropped and logged.
 * The example is optional: the schema requires the field, empty when there is none.
 */
function keepValidQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  const isText = (value) => typeof value === 'string' && value.trim() !== '';
  const valid = questions.filter((q, index) => {
    const problem = !q || typeof q !== 'object' ? 'missing question'
      : !isText(q.question) ? 'empty "question" field'
      : !Array.isArray(q.options) || q.options.length !== 4 ? 'exactly 4 options are needed'
      : !q.options.every(isText) ? 'empty option'
      : !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3 ? 'invalid correct answer index'
      : !isText(q.explanation) ? 'empty "explanation" field'
      : null;
    if (problem) console.warn(`⚠️ Question ${index + 1} dropped: ${problem}`);
    return !problem;
  });

  return valid.map(q => ({ ...q, example: typeof q.example === 'string' ? q.example : '' }));
}

/**
 * Claude hands over to Groq when it cannot answer: content refusal, or 400 error
 * (credit exhausted...). A refused schema is not one of them: it would be a code
 * error, silently sending every premium user to Groq. It is thrown as is and not
 * retried.
 */
function shouldFallbackToGroq(error) {
  if (error.refusal) return true;
  if (error.status !== 400) return false;

  if (/output_config|json_schema|schema|grammar/i.test(error.message)) {
    console.error('❌ Output schema refused by Claude, no fallback to Groq:', error.message);
    error.noRetry = true;
    return false;
  }
  return true;
}

/**
 * One generation call: Claude for premium classes, Groq otherwise or as fallback.
 * The prompt is built for the provider that answers, since the number of questions
 * asked depends on its output limit.
 * @param {(range: {min: number, max: number}) => string} buildPrompt
 * @param {{premium: boolean, fallback: boolean}} provider - fallback becomes true when Claude is set aside
 */
async function generateBatch(buildPrompt, provider) {
  if (provider.premium && !provider.fallback) {
    try {
      return await generateWithClaude(buildPrompt(QUESTIONS_PER_CALL.claude));
    } catch (error) {
      if (!shouldFallbackToGroq(error)) throw error;
      console.warn(`⚠️ Claude set aside (${error.message.slice(0, 120)}), switching to Groq (free)...`);
      provider.fallback = true;
    }
  }
  return generateWithGroq(buildPrompt(QUESTIONS_PER_CALL.groq));
}

/**
 * Generates with retries until there are 20 questions. Later attempts use the same
 * prompt, with the questions already generated so they are not repeated. Questions
 * that refer to missing code are dropped. An error that would come back the same
 * (noRetry) is not retried. The thrown messages are in French: they are shown to
 * the user.
 */
async function generateWithRetry(assignment, isPremium, documentsText) {
  const MAX_RETRIES = 5;
  const MIN_QUESTIONS = 20;
  let allQuestions = [];
  let attempts = 0;
  const provider = { premium: isPremium, fallback: false };

  console.log(`🎯 Goal: at least ${MIN_QUESTIONS} questions`);
  console.log(`🤖 Mode: ${isPremium ? 'Premium (Claude)' : 'Free (Groq)'}`);

  while (attempts < MAX_RETRIES && allQuestions.length < MIN_QUESTIONS) {
    attempts++;

    try {
      let newQuestions;

      if (allQuestions.length === 0) {
        console.log(`📝 Attempt ${attempts}/${MAX_RETRIES} - initial generation...`);
        newQuestions = await generateBatch(range => createPrompt(assignment, documentsText, range), provider);
      } else {
        console.log(`📝 Attempt ${attempts}/${MAX_RETRIES} - asking for more questions...`);
        newQuestions = await generateBatch(range => createPrompt(assignment, documentsText, range, allQuestions), provider);
      }

      const countBeforeFilter = newQuestions.length;
      newQuestions = newQuestions.filter(q => !referencesMissingCode(q));
      if (newQuestions.length < countBeforeFilter) {
        console.warn(`⚠️ ${countBeforeFilter - newQuestions.length} question(s) dropped: they refer to missing code`);
      }

      allQuestions = allQuestions.concat(newQuestions);

      console.log(`✓ ${newQuestions.length} questions generated (total: ${allQuestions.length}/${MIN_QUESTIONS})`);

      if (allQuestions.length >= MIN_QUESTIONS) {
        console.log(`✅ Goal reached: ${allQuestions.length} questions`);
        break;
      }

    } catch (error) {
      console.error(`❌ Attempt ${attempts} failed:`, error.message);

      if (error.noRetry) throw error;

      if (attempts >= MAX_RETRIES && allQuestions.length < MIN_QUESTIONS) {
        throw new Error(`Impossible de générer 20 questions après ${MAX_RETRIES} tentatives. Seulement ${allQuestions.length} questions générées.`, { cause: error });
      }
    }
  }

  if (allQuestions.length < MIN_QUESTIONS) {
    throw new Error(`Impossible de générer ${MIN_QUESTIONS} questions après ${MAX_RETRIES} tentatives. Seulement ${allQuestions.length} questions générées.`);
  }

  return allQuestions;
}

/**
 * Generates the quiz of an assignment from its attached files: converts them to
 * PDF, extracts their text, then generates at least 20 questions. The thrown
 * messages are in French: they are shown to the user.
 * @param {Object} assignment
 * @param {boolean} isPremium - use Claude instead of Groq
 * @param {Array<{filename: string}>} files
 */
async function generateQuizWithAi(assignment, isPremium, files) {
  const uploadsDir = path.join(__dirname, '../uploads');
  const documentsTexts = [];

  console.log(`📄 Extracting ${files.length} document(s)...`);

  for (const file of files) {
    let filePath = path.join(uploadsDir, file.filename);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ File not found: ${filePath}`);
      continue;
    }

    try {
      filePath = await convertToPdf(filePath);
    } catch (error) {
      console.error(`❌ Conversion failed: ${error.message}`);
      continue;
    }

    const text = await extractTextFromPdf(filePath);
    if (text) {
      documentsTexts.push(text);
    }
  }

  if (documentsTexts.length === 0) {
    throw new Error('Impossible d\'extraire le texte des documents. Les PDFs sont peut-être vides, protégés ou contiennent uniquement des images.');
  }

  const documentsText = documentsTexts.join('\n\n--- DOCUMENT SUIVANT ---\n\n');
  const totalChars = documentsText.length;

  console.log(`📊 Extracted content: ${totalChars} characters in total`);

  if (totalChars < 500) {
    throw new Error('Le contenu des documents est insuffisant pour générer un quiz. Les documents doivent contenir au moins 500 caractères de texte extractible.');
  }

  const questions = await generateWithRetry(assignment, isPremium, documentsText);

  console.log(`🎉 Quiz generated: ${questions.length} questions`);

  return questions;
}

module.exports = {
  generateQuizWithAi,
  extractTextFromPdf,
  referencesMissingCode,
  createPrompt,
  parseQuestions,
  keepValidQuestions,
  questionsFromGroqError,
  shouldFallbackToGroq,
  QUIZ_SCHEMA
};
