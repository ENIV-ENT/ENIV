#!/usr/bin/env node
/**
 * Manual test of the quiz generation on a sample assignment.
 *
 * Usage: node scripts/testQuizGeneration.js [--groq]
 *
 * Generates with Claude (premium) by default, or with Groq (standard) with --groq.
 * The sample file must exist in backend/uploads/.
 * @module
 */

require('dotenv').config();
const { generateQuizWithAi } = require('../backend/services/quizGenerator');

const testAssignment = {
  id: 1,
  titre: 'Test Révision 42',
  matiere_nom: '42 Project',
  description: 'Révision sur la l\'objectif du projet',
  date: '2025-11-10'
};

const testFiles = [
  { filename: 'TBFAR312 Multicultural Environments.pdf' }
];

const useGroq = process.argv.includes('--groq');

async function testGeneration() {
  console.log('🧪 Quiz generation test\n');
  console.log('Assignment:', testAssignment.titre);
  console.log('Subject:', testAssignment.matiere_nom);
  console.log('\n⏳ Generating...\n');

  try {
    console.log(useGroq ? '--- Groq (standard) ---' : '--- Claude (premium) ---');
    const questions = await generateQuizWithAi(testAssignment, !useGroq, testFiles);
    console.log('✅ Generation done!');
    console.log(`📝 Number of questions: ${questions.length}`);
    console.log('\nQuestions:');
    console.log(JSON.stringify(questions, null, 2));

    console.log('\n🎉 Test passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nDetails:', error);
    process.exit(1);
  }
}

console.log('🔍 Checking the configuration...\n');

if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY missing from .env');
  process.exit(1);
}
console.log('✅ GROQ_API_KEY found');

if (!process.env.PREMIUM_API_KEY) {
  console.warn('⚠️  PREMIUM_API_KEY missing (Claude test disabled)');
} else {
  console.log('✅ PREMIUM_API_KEY found');
}

console.log('\n');

testGeneration();
