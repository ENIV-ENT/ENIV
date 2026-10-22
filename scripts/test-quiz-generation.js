#!/usr/bin/env node
/**
 * Script de test pour la génération de quiz
 * 
 * Usage: node scripts/test-quiz-generation.js
 */

require('dotenv').config();
const { generateQuizWithAi } = require('../backend/services/quizGenerator');

// Devoir de test
const testDevoir = {
  id: 1,
  titre: 'Test Révision 42',
  matiere_nom: '42 Project',
  description: 'Révision sur la l\'objectif du projet',
  date: '2025-11-10'
};

// Fichiers de test (simulés)
const testFichiers = [
  { filename: 'TBFAR312 Multicultural Environments.pdf' } // Assurez-vous qu'un fichier test existe dans backend/uploads/
];

async function testGeneration() {
  console.log('🧪 Test de génération de quiz\n');
  console.log('Devoir:', testDevoir.titre);
  console.log('Matière:', testDevoir.matiere_nom);
  console.log('\n⏳ Génération en cours...\n');

  try {
    // Test avec Groq (gratuit)
    // console.log('--- Test avec Groq (Standard) ---');
    // const questionsGroq = await generateQuizWithAi(testDevoir, false, testFichiers);
    // console.log('✅ Génération Groq réussie !');
    // console.log(`📝 Nombre de questions: ${questionsGroq.length}`);
    // console.log('\nExemple de question:');
    // console.log(JSON.stringify(questionsGroq[0], null, 2));
    // console.log('\n');

    // Test avec Claude (premium) - décommenter si vous avez une clé Claude
    console.log('--- Test avec Claude (Premium) ---');
    const questionsClaude = await generateQuizWithAi(testDevoir, true, testFichiers);
    console.log('✅ Génération Claude réussie !');
    console.log(`📝 Nombre de questions: ${questionsClaude.length}`);
    console.log('\nExemple de question:');
    console.log(JSON.stringify(questionsClaude, null, 2));

    console.log('\n🎉 Tests terminés avec succès !');
  } catch (error) {
    console.error('\n❌ Erreur lors du test:', error.message);
    console.error('\nDétails:', error);
    process.exit(1);
  }
}

// Vérification des variables d'environnement
console.log('🔍 Vérification de la configuration...\n');

if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY manquante dans .env');
  process.exit(1);
}
console.log('✅ GROQ_API_KEY trouvée');

if (!process.env.PREMIUM_API_KEY) {
  console.warn('⚠️  PREMIUM_API_KEY manquante (test Claude désactivé)');
} else {
  console.log('✅ PREMIUM_API_KEY trouvée');
}

console.log('\n');

// Lancer le test
testGeneration();
