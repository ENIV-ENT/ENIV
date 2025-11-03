require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { convertToPDF } = require('./fileConverter');

/**
 * Extraire le texte d'un fichier PDF
 */
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    
    // pdf-parse v1.1.1 : fonction directe qui retourne { text: "..." }
    const data = await pdfParse(dataBuffer);
    
    const text = data.text || '';
    
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
      "question": "Quelle est la capitale de la France ?",
      "options": [
        "Paris",
        "Londres",
        "Berlin",
        "Madrid"
      ],
      "correct": 0,
      "explanation": "Paris est la capitale et la plus grande ville de France depuis le XIIe siècle.",
      "example": "Paris compte plus de 2 millions d'habitants intra-muros et environ 12 millions dans l'agglomération."
    }
  ];

  return `Tu es un assistant pédagogique expert. Tu dois générer un questionnaire complet pour réviser une évaluation.

CONTEXTE DU DEVOIR :
- Titre : ${devoir.titre}
- Matière : ${devoir.matiere_nom || 'Non spécifiée'}
- Description : ${devoir.description || 'Non spécifiée'}
- Date : ${devoir.date || 'Non spécifiée'}

⚠️ IMPORTANT - CONTENU DES DOCUMENTS :
La matière (${devoir.matiere_nom || 'Non spécifiée'}) est indiquée uniquement pour te donner le contexte.
Tu dois générer les questions EXCLUSIVEMENT à partir du contenu PÉDAGOGIQUE des documents PDF ci-dessous.

RÈGLES STRICTES :
- Ne génère PAS de questions générales sur la matière
- Ne génère PAS de questions sur le document lui-même (version, auteur, format, structure, etc.)
- Ne génère PAS de questions sur les métadonnées (dates de publication, copyright, etc.)
- Concentre-toi UNIQUEMENT sur le contenu ÉDUCATIF et les CONCEPTS enseignés
- Chaque question doit porter sur une CONNAISSANCE ou un CONCEPT présent dans les documents
- Chaque question doit être basée sur une information PRÉCISE et PÉDAGOGIQUE trouvée dans les documents
- Ignore les pages de couverture, disclaimers, tables des matières, etc.

DOCUMENTS DU DEVOIR :
${documentsText}

INSTRUCTIONS :
1. Génère un questionnaire de MINIMUM 20 questions et MAXIMUM 100 questions pour réviser cette évaluation
2. Base TOUTES les questions sur le contenu PÉDAGOGIQUE et les CONCEPTS enseignés dans les documents
3. IGNORE complètement les informations sur le document lui-même (version, auteur, structure, copyright, etc.)
4. Ne crée PAS de questions basées sur des connaissances générales de la matière
5. Priorise les concepts et informations les plus importants trouvés dans les documents
6. Crée des questions variées (faciles: 30%, moyennes: 50%, difficiles: 20%)
7. Chaque question doit avoir 4 options de réponse
8. Une seule réponse correcte par question
9. Fournis une explication claire citant le concept ou l'information pédagogique du document
10. Ajoute un exemple concret lié au concept enseigné si pertinent
11. Couvre tous les aspects PÉDAGOGIQUES importants des documents fournis
12. Assure-toi que les questions testent la COMPRÉHENSION et l'APPRENTISSAGE du contenu

FORMAT DE RÉPONSE :
Tu dois répondre UNIQUEMENT avec un tableau JSON valide, sans aucun texte avant ou après.
Format attendu : ${JSON.stringify(exampleQuestions, null, 2)}

IMPORTANT : 
- Réponds UNIQUEMENT avec le JSON, pas de texte explicatif
- Génère MINIMUM 20 questions basées sur le CONTENU PÉDAGOGIQUE des documents
- Si le contenu le permet, va jusqu'à 100 questions pour une révision complète
- Chaque question doit tester la COMPRÉHENSION d'un CONCEPT ou d'une CONNAISSANCE
- IGNORE toutes les informations non-pédagogiques (métadonnées, structure du document, etc.)`;
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
    model: 'llama-3.3-70b-versatile',
    messages: [{
      role: 'user',
      content: prompt
    }],
    temperature: 0.7,
    max_tokens: 16000
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
  return `Tu es un assistant pédagogique expert. Tu as déjà généré ${existing.length} questions pour un quiz, mais il en faut PLUS pour avoir un quiz complet.

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
    "question": "Question claire",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct": 0,
    "explanation": "Explication de la bonne réponse",
    "example": "Exemple concret (optionnel)"
  }
]

RÈGLES STRICTES :
- MINIMUM 20 nouvelles questions
- Questions DIFFÉRENTES de celles déjà générées
- Basées sur le CONTENU PÉDAGOGIQUE uniquement
- Pas de questions sur les métadonnées du document
- Couvre différents aspects du contenu
- Format JSON valide sans texte avant/après`;
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
  generateQuizWithAI
};
