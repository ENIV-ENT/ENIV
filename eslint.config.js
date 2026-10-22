const js = require('@eslint/js');
const globals = require('globals');

const FRENCH_WORDS = [
  'devoir', 'matiere', 'eleve(?!n)', 'etablissement', 'etab(?![a-z])', 'commentaire', 'fichier', 'jeton',
  'emploi', 'classe(?!s(?![a-z]))', 'statut', 'rappel', 'recapitulatif', 'semaine', 'aujourd', 'parametre',
  'utilisateur', 'couleur', 'titre', 'envoyer', 'creer', 'afficher', 'ouvrir', 'fermer', 'supprimer',
  'ajouter', 'rafraichir', 'associer', 'normaliser', 'preparer', 'grouper', 'joindre', 'partager',
  'analyser', 'fusionner',
];

const NO_FRENCH_WORD = `^(?!.*(?:${FRENCH_WORDS.map((word) => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`).join('|')})).*$`;

module.exports = [
  {
    ignores: ['node_modules/**', '.claude/**', 'backend/uploads/**', 'public/vendor/**'],
  },
  js.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      camelcase: ['error', { properties: 'never', ignoreDestructuring: false, ignoreImports: false, ignoreGlobals: false }],
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],
      'id-match': ['error', NO_FRENCH_WORD, { properties: false, classFields: true, onlyDeclarations: true, ignoreDestructuring: false }],
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  {
    files: ['public/js/pages/register.js'],
    languageOptions: {
      globals: { L: 'readonly' },
    },
  },
  {
    files: ['public/js/pwa.js', 'public/js/theme-init.js'],
    languageOptions: {
      sourceType: 'script',
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.serviceworker,
    },
  },
];
