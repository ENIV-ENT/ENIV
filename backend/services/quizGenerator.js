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
 * Créer le prompt pour l'IA
 */
function createPrompt(devoir, documentsText, maxQuestions) {
  return `Tu es un assistant pédagogique expert. Tu dois générer un questionnaire pour aider les étudiants à RÉVISER le COURS en vue d'une ÉVALUATION.

🎯 OBJECTIF DU QCM :
Ce QCM a pour but de réviser les connaissances et concepts du COURS afin de se préparer à une évaluation.
Les documents fournis peuvent être :
- Des COURS (support principal de révision)
- Des TRAVAUX PRATIQUES (TPs) qui illustrent l'application des concepts du cours

CONTEXTE DU DEVOIR :
- Titre : ${devoir.titre}
- Matière : ${devoir.matiere_nom || 'Non spécifiée'}
- Description : ${devoir.description || 'Non spécifiée'}
- Date : ${devoir.date || 'Non spécifiée'}

⚠️ RÈGLES STRICTES CONCERNANT LES TPs :
- NE POSE JAMAIS de questions du type "Dans le TP2, quelle est..." ou "Selon le TP..."
- NE POSE PAS de questions spécifiques aux exercices pratiques des TPs
- NE DEMANDE PAS ce qui a été fait dans tel ou tel TP
- Les TPs servent UNIQUEMENT d'inspiration pour comprendre quels concepts sont importants
- Utilise les TPs pour identifier les concepts clés à réviser, mais pose des questions de COURS

✅ CE QU'IL FAUT FAIRE :
- Poser des questions de COURS sur les concepts théoriques
- Pour les matières avec du code, n'hésite PAS à proposer des EXEMPLES DE CODE et demander :
  * Ce que ce code retourne
  * Quel sera le résultat de l'exécution
  * Identifier les erreurs dans le code
  * Expliquer le comportement du code
- Tester la COMPRÉHENSION des concepts à travers des exemples concrets
- Créer tes propres exemples de code originaux (pas ceux des TPs)

❌ CE QU'IL NE FAUT PAS FAIRE :
- Questions générales non liées aux documents
- Questions sur le document lui-même (version, auteur, format, structure)
- Questions sur les métadonnées (dates de publication, copyright)
- Questions spécifiques aux TPs ("Dans le TP1...", "L'exercice 2 du TP...")
- Pages de couverture, disclaimers, tables des matières

DOCUMENTS DU DEVOIR :
${documentsText}

INSTRUCTIONS :
1. Génère un questionnaire de MINIMUM 20 questions et MAXIMUM ${maxQuestions} questions pour RÉVISER le COURS
2. Base TOUTES les questions sur les CONCEPTS et CONNAISSANCES du COURS présents dans les documents
3. Si les documents contiennent du CODE :
   - Propose des exemples de code et demande ce qu'ils retournent
   - Crée des questions sur le comportement du code
   - Demande d'identifier les erreurs ou problèmes dans un code
   - Teste la compréhension de la syntaxe et des concepts de programmation
4. IGNORE :
   - Les questions spécifiques aux TPs ("Dans le TP1...", "L'exercice 2...")
   - Les informations sur le document (version, auteur, structure, copyright)
   - Les connaissances générales non présentes dans les documents
5. Crée des questions variées (faciles: 30%, moyennes: 50%, difficiles: 20%)
6. Chaque question doit avoir 4 options de réponse
7. Une seule réponse correcte par question
8. Fournis une explication claire basée sur le COURS
9. Ajoute un exemple concret si pertinent (surtout pour le code)
10. Couvre tous les concepts importants du COURS
11. Teste la COMPRÉHENSION et la capacité à APPLIQUER les concepts

⚠️ RÈGLES POUR LES RÉPONSES :
- Toutes les options de réponse doivent être de longueur approximativement égale (à 10-20% près)
- Inclus des QUESTIONS PIÈGES avec des réponses plausibles mais incorrectes
- Certaines mauvaises réponses doivent ressembler à la bonne (exemple: "ça marche" vs "ça ne marche pas")
- Évite les réponses évidentes comme "Aucune de ces réponses" ou "Toutes les réponses"
- Les mauvaises réponses doivent être crédibles et basées sur des erreurs courantes
- Les réponses doivent tester la compréhension fine, pas juste la mémorisation
- UNE SEULE réponse correcte par question (pas plusieurs bonnes réponses)
- NE JAMAIS référencer la position des réponses (A, B, C, D ou 1, 2, 3, 4) dans la question ou l'explication
- Les réponses sont affichées dans un ORDRE ALÉATOIRE, donc ne dis JAMAIS "la réponse B" ou "la deuxième option"
- Dans l'explication, désigne la bonne réponse par son CONTENU, pas par sa position

⚠️ RÈGLES POUR LE CHAMP "example" :
- Le champ "example" est affiché UNIQUEMENT APRÈS que l'étudiant ait répondu
- Il sert à montrer un EXEMPLE D'APPLICATION ou d'UTILISATION du concept
- NE METS JAMAIS une partie de la question dans "example"
- Si ta question contient du code à analyser, mets ce code dans "question", PAS dans "example"
- Le champ "example" doit apporter une valeur ajoutée APRÈS avoir compris la réponse

IMPORTANT POUR LE CODE :
- Si tu inclus du code dans les questions, réponses ou explications, tu DOIS le mettre entre ''' code '''
- Par exemple: '''const x = 5;''' ou '''function hello() { return "world"; }'''
- Le code sera automatiquement affiché dans un bloc de code formaté avec coloration syntaxique
- Respecte toujours cette syntaxe pour que le code soit lisible

IMPORTANT :
- Génère MINIMUM 20 questions basées sur les CONCEPTS du COURS
- Si le contenu le permet, va jusqu'à ${maxQuestions} questions pour une révision complète
- Pour le code : propose des EXEMPLES et teste la COMPRÉHENSION du comportement
- Utilise ''' code ''' pour tout extrait de code dans les questions/réponses/explications
- Chaque question doit tester la COMPRÉHENSION et l'APPLICATION des concepts
- NE POSE JAMAIS de questions sur "le TP1", "l'exercice 2", etc.
- Les TPs sont une source d'inspiration pour les concepts, PAS pour les questions directes
- QUESTIONS PIÈGES : inclus des réponses qui semblent correctes mais ne le sont pas (ex: "ça fonctionne" vs "ça ne fonctionne pas")
- LONGUEUR ÉGALE : toutes les options doivent avoir une longueur similaire (±10-20%)
- Les mauvaises réponses doivent être plausibles et basées sur des erreurs de compréhension courantes
- CHAMP "example" : il est affiché APRÈS la réponse, ne mets JAMAIS du code de la question dedans
- Si tu dois montrer du code à analyser, mets-le dans "question", pas dans "example"
- CHAQUE QUESTION SE SUFFIT À ELLE-MÊME : l'étudiant n'a ni le cours ni les TPs sous les yeux. Une question sur un code, un Dockerfile, un fichier ou une commande contient ce code en entier dans "question", entre ''' ''' (ex : "Que fait ce Dockerfile ? '''FROM node COPY . /app'''"). Sans code à montrer, pose une question générale qui ne le désigne pas (ex : "Quelle instruction définit l'image de base d'un Dockerfile ?" et non "Que fait ce Dockerfile ?")
- Le champ "example" sert à montrer une APPLICATION ou UTILISATION du concept, pas à poser la question
- UNE SEULE BONNE RÉPONSE : le champ "correct" doit pointer vers UNE SEULE option (0, 1, 2 ou 3)
- NE RÉFÉRENCE JAMAIS les positions A/B/C/D ou 1/2/3/4 : les réponses sont affichées dans un ordre ALÉATOIRE
- Dans ton explication, parle du CONTENU de la réponse ("Paris est correct car..."), pas de sa position ("La réponse A est correcte...")`;
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
    example: { type: 'string', description: "Exemple d'application du concept, chaîne vide s'il n'y en a pas ; jamais le code de la question" }
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
// 16000 tokens de sortie. Groq en a 4096, et l'offre gratuite plafonne à 8000
// tokens par minute en tout (document compris) : on n'y demande pas plus que ce
// qui tient, la boucle de génération complète si besoin.
const MAX_QUESTIONS = { claude: 100, groq: 25 };

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
 * Créer un prompt pour compléter un quiz
 */
function create_completion_prompt(devoir, documentsText, existing, maxQuestions) {
  return `Tu es un assistant pédagogique expert. Tu as déjà généré ${existing.length} questions pour un quiz de RÉVISION du COURS, mais il en faut PLUS.

DEVOIR : ${devoir.titre}
${devoir.description ? 'DESCRIPTION : ' + devoir.description : ''}

QUESTIONS DÉJÀ GÉNÉRÉES (à ne PAS répéter) :
${existing.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

DOCUMENTS :
${documentsText}

GÉNÈRE MINIMUM 20 NOUVELLES QUESTIONS différentes de celles ci-dessus.
Plus tu en génères, mieux c'est (jusqu'à ${maxQuestions} si le contenu le permet).

RÈGLES STRICTES :
- MINIMUM 20 nouvelles questions
- Questions de COURS (pas de "Dans le TP1..." ou "L'exercice 2...")
- Pour le code : propose des exemples et demande ce qu'ils retournent
- Questions DIFFÉRENTES de celles déjà générées
- Basées sur les CONCEPTS du COURS uniquement
- Teste la COMPRÉHENSION et l'APPLICATION des concepts
- Si tu inclus du code, utilise ''' code ''' pour le délimiter
- QUESTIONS PIÈGES : inclus des réponses plausibles mais incorrectes (ex: "ça marche" vs "ça ne marche pas")
- LONGUEUR ÉGALE : toutes les options de réponse doivent avoir une longueur similaire (±10-20%)
- Les mauvaises réponses doivent être crédibles et basées sur des erreurs courantes
- CHAMP "example" : affiché APRÈS la réponse, pour montrer l'UTILISATION du concept, pas pour poser la question
- Si tu veux montrer du code à analyser, mets-le dans "question", JAMAIS dans "example"
- CHAQUE QUESTION SE SUFFIT À ELLE-MÊME : une question sur un code, un Dockerfile, un fichier ou une commande contient ce code en entier dans "question", entre ''' '''. Sans code à montrer, pose une question générale qui ne le désigne pas (« Quelle instruction définit l'image de base ? » et non « Que fait ce Dockerfile ? »)
- UNE SEULE BONNE RÉPONSE : le champ "correct" doit être 0, 1, 2 ou 3 (une seule valeur)
- NE RÉFÉRENCE JAMAIS A/B/C/D ou 1/2/3/4 : les réponses sont affichées dans un ORDRE ALÉATOIRE
- Dans l'explication, parle du CONTENU de la réponse, pas de sa position (pas de "la réponse B" ou "la deuxième option")`;
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
 * @param {(maxQuestions: number) => string} buildPrompt
 * @param {{premium: boolean, fallback: boolean}} provider - fallback passe à true quand Claude est écarté
 */
async function generateBatch(buildPrompt, provider) {
  if (provider.premium && !provider.fallback) {
    try {
      return await generateWithClaude(buildPrompt(MAX_QUESTIONS.claude));
    } catch (error) {
      if (!shouldFallbackToGroq(error)) throw error;
      console.warn(`⚠️ Claude écarté (${error.message.slice(0, 120)}), basculement vers Groq (gratuit)...`);
      provider.fallback = true;
    }
  }
  return generateWithGroq(buildPrompt(MAX_QUESTIONS.groq));
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
        newQuestions = await generateBatch(max => createPrompt(devoir, documentsText, max), provider);
      } else {
        // Tentatives suivantes : compléter avec minimum 20 questions
        console.log(`📝 Tentative ${attempts}/${MAX_RETRIES} - Demande de questions supplémentaires (minimum 20)...`);
        newQuestions = await generateBatch(max => create_completion_prompt(devoir, documentsText, allQuestions, max), provider);
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
  parseQuestions,
  keepValidQuestions,
  questionsFromGroqError,
  shouldFallbackToGroq,
  QUIZ_SCHEMA
};
