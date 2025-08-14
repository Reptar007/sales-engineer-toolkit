// eslint.config.mjs
import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import pluginN from 'eslint-plugin-n';
import pluginPromise from 'eslint-plugin-promise';
import prettier from 'eslint-config-prettier';
import globals from 'globals'; // <-- add this

export default [
  { ignores: ['node_modules', 'dist', 'build', '**/*.min.js'] },
  js.configs.recommended,

  {
    plugins: {
      import: pluginImport,
      n: pluginN,
      promise: pluginPromise,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node, // <-- Node globals (includes console)
        // If you also run code in browsers, add:
        // ...globals.browser,
      },
    },
    rules: {
      ...(pluginImport.configs.recommended?.rules ?? {}),
      ...(pluginN.configs['flat/recommended']?.rules ?? {}),
      ...(pluginPromise.configs['flat/recommended']?.rules ?? {}),
      'import/order': ['warn', { alphabetize: { order: 'asc', caseInsensitive: true } }],
      'n/no-missing-import': 'off',
    },
  },

  prettier,
];
