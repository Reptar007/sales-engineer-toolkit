// eslint.config.mjs
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Base config for all JS files
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }, // default to Node.js globals
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  // Browser-specific override for UI apps
  {
    files: ['apps/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser }, // allow window, document, etc.
    },
  },

  // Ignore linting the dist/build outputs
  {
    ignores: ['**/dist/**', '**/build/**'],
  },
];
