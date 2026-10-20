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
function createPrompt(devoir, documentsText) {
  const exampleQuestions = [
    {
      "question": "Quel est le rôle principal de Paris dans l'organisation territoriale française ?",
      "options": [
        "Paris est la capitale administrative et politique de la France",
        "Paris est uniquement une ville touristique sans rôle politique",
        "Paris est la deuxième ville la plus importante après Lyon",
        "Paris est seulement un centre économique sans rôle politique"
      ],
      "correct": 0,
      "explanation": "Paris est la capitale et la plus grande ville de France depuis le XIIe siècle. Elle concentre les institutions politiques, administratives et culturelles du pays.",
      "example": "Les principales institutions comme l'Élysée, Matignon et l'Assemblée nationale sont toutes situées à Paris, illustrant son rôle de capitale politique."
    }
  ];

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
1. Génère un questionnaire de MINIMUM 20 questions et MAXIMUM 100 questions pour RÉVISER le COURS
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

FORMAT DE RÉPONSE :
Tu dois répondre UNIQUEMENT avec un tableau JSON valide, sans aucun texte avant ou après.
Format attendu : ${JSON.stringify(exampleQuestions, null, 2)}

IMPORTANT POUR LE CODE :
- Si tu inclus du code dans les questions, réponses ou explications, tu DOIS le mettre entre ''' code '''
- Par exemple: '''const x = 5;''' ou '''function hello() { return "world"; }'''
- Le code sera automatiquement affiché dans un bloc de code formaté avec coloration syntaxique
- Respecte toujours cette syntaxe pour que le code soit lisible

IMPORTANT :
- Réponds UNIQUEMENT avec le JSON, pas de texte explicatif
- Génère MINIMUM 20 questions basées sur les CONCEPTS du COURS
- Si le contenu le permet, va jusqu'à 100 questions pour une révision complète
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
- JAMAIS de question qui renvoie à un code absent : si la question dit « ce code », « ce Dockerfile », « ce fichier YAML » ou « cette commande », le code complet DOIT figurer dans "question" entre ''' ''' (sinon l'étudiant ne voit rien à analyser). Si tu ne peux pas l'inclure, reformule la question sans y faire référence
- Le champ "example" sert à montrer une APPLICATION ou UTILISATION du concept, pas à poser la question
- UNE SEULE BONNE RÉPONSE : le champ "correct" doit pointer vers UNE SEULE option (0, 1, 2 ou 3)
- NE RÉFÉRENCE JAMAIS les positions A/B/C/D ou 1/2/3/4 : les réponses sont affichées dans un ordre ALÉATOIRE
- Dans ton explication, parle du CONTENU de la réponse ("Paris est correct car..."), pas de sa position ("La réponse A est correcte...")`;
}

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
      }]
    });

    const content = message.content[0].text;
    return extractJSON(content);
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

  const completion = await client.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [{
      role: 'user',
      content: prompt
    }],
    temperature: 0.7,
    max_tokens: 4096
  });

  const content = completion.choices[0].message.content;
  return extractJSON(content);
}

/**
 * Extraire le JSON de la réponse
 */
function extractJSON(text) {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Format JSON invalide dans la réponse');
  }

  const questions = JSON.parse(jsonMatch[0]);
  validateQuestionsFormat(questions);
  
  return questions;
}

/**
 * Valider le format des questions (sans vérifier le minimum)
 */
function validateQuestionsFormat(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Le quiz doit contenir au moins une question');
  }

  questions.forEach((q, index) => {
    if (!q.question || typeof q.question !== 'string') {
      throw new Error(`Question ${index + 1}: champ "question" invalide`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`Question ${index + 1}: doit avoir exactement 4 options`);
    }
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
      throw new Error(`Question ${index + 1}: indice de réponse correcte invalide`);
    }
    if (!q.explanation || typeof q.explanation !== 'string') {
      throw new Error(`Question ${index + 1}: champ "explanation" invalide`);
    }
  });
}

/**
 * Créer un prompt pour compléter un quiz
 */
function create_completion_prompt(devoir, documentsText, existing) {
  return `Tu es un assistant pédagogique expert. Tu as déjà généré ${existing.length} questions pour un quiz de RÉVISION du COURS, mais il en faut PLUS.

DEVOIR : ${devoir.titre}
${devoir.description ? 'DESCRIPTION : ' + devoir.description : ''}

QUESTIONS DÉJÀ GÉNÉRÉES (à ne PAS répéter) :
${existing.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

DOCUMENTS :
${documentsText}

GÉNÈRE MINIMUM 20 NOUVELLES QUESTIONS différentes de celles ci-dessus.
Plus tu en génères, mieux c'est (tu peux aller jusqu'à 50-100 si le contenu le permet).

Format JSON strict :
[
  {
    "question": "Question claire (mets le code ici si besoin)",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct": 0,
    "explanation": "Explication de la bonne réponse",
    "example": "Exemple d'APPLICATION du concept (optionnel, JAMAIS le code de la question)"
  }
]

RÈGLES STRICTES :
- MINIMUM 20 nouvelles questions
- Questions de COURS (pas de "Dans le TP1..." ou "L'exercice 2...")
- Pour le code : propose des exemples et demande ce qu'ils retournent
- Questions DIFFÉRENTES de celles déjà générées
- Basées sur les CONCEPTS du COURS uniquement
- Teste la COMPRÉHENSION et l'APPLICATION des concepts
- Format JSON valide sans texte avant/après
- Si tu inclus du code, utilise ''' code ''' pour le délimiter
- QUESTIONS PIÈGES : inclus des réponses plausibles mais incorrectes (ex: "ça marche" vs "ça ne marche pas")
- LONGUEUR ÉGALE : toutes les options de réponse doivent avoir une longueur similaire (±10-20%)
- Les mauvaises réponses doivent être crédibles et basées sur des erreurs courantes
- CHAMP "example" : affiché APRÈS la réponse, pour montrer l'UTILISATION du concept, pas pour poser la question
- Si tu veux montrer du code à analyser, mets-le dans "question", JAMAIS dans "example"
- JAMAIS de question qui renvoie à un code absent (« ce code », « ce Dockerfile », « ce fichier YAML »...) : le code complet DOIT figurer dans "question" entre ''' ''', sinon reformule sans y faire référence
- UNE SEULE BONNE RÉPONSE : le champ "correct" doit être 0, 1, 2 ou 3 (une seule valeur)
- NE RÉFÉRENCE JAMAIS A/B/C/D ou 1/2/3/4 : les réponses sont affichées dans un ORDRE ALÉATOIRE
- Dans l'explication, parle du CONTENU de la réponse, pas de sa position (pas de "la réponse B" ou "la deuxième option")`;
}

/**
 * Générer avec retry jusqu'à avoir 20 questions
 */
async function generate_with_retry(devoir, isPremium, documentsText) {
  const MAX_RETRIES = 5;
  const MIN_QUESTIONS = 20;
  let allQuestions = [];
  let attempts = 0;
  let useFallback = false; // Pour basculer vers Groq si Claude échoue

  console.log(`🎯 Objectif: ${MIN_QUESTIONS} questions minimum`);
  console.log(`🤖 Mode: ${isPremium ? 'Premium (Claude)' : 'Gratuit (Groq)'}`);

  while (attempts < MAX_RETRIES && allQuestions.length < MIN_QUESTIONS) {
    attempts++;
    
    try {
      let newQuestions = [];
      
      if (allQuestions.length === 0) {
        // Première tentative : prompt normal
        console.log(`📝 Tentative ${attempts}/${MAX_RETRIES} - Génération initiale...`);
        const prompt = createPrompt(devoir, documentsText);
        
        if (isPremium && !useFallback) {
          try {
            newQuestions = await generateWithClaude(prompt);
          } catch (error) {
            // Si erreur 400 avec Claude, basculer vers Groq
            if (error.status === 400 || error.message.includes('400')) {
              console.warn('⚠️ Erreur 400 avec Claude, basculement vers Groq (gratuit)...');
              useFallback = true;
              newQuestions = await generateWithGroq(prompt);
            } else {
              throw error;
            }
          }
        } else {
          newQuestions = await generateWithGroq(prompt);
        }
      } else {
        // Tentatives suivantes : compléter avec minimum 20 questions
        console.log(`📝 Tentative ${attempts}/${MAX_RETRIES} - Demande de questions supplémentaires (minimum 20)...`);
        const prompt = create_completion_prompt(devoir, documentsText, allQuestions);
        
        if (isPremium && !useFallback) {
          try {
            newQuestions = await generateWithClaude(prompt);
          } catch (error) {
            if (error.status === 400 || error.message.includes('400')) {
              console.warn('⚠️ Erreur 400 avec Claude, basculement vers Groq (gratuit)...');
              useFallback = true;
              newQuestions = await generateWithGroq(prompt);
            } else {
              throw error;
            }
          }
        } else {
          newQuestions = await generateWithGroq(prompt);
        }
      }

      // Valider le format
      validateQuestionsFormat(newQuestions);
      
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
  extractTextFromPDF
};
