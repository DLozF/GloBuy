// Flat ESLint config. The extension source is plain browser IIFE modules (no
// build step); tests are CommonJS for `node --test`.
const js = require('@eslint/js');
const globals = require('globals');

// Modules assign their API onto globalThis and read each other's — declare them
// so cross-file references aren't flagged as undefined.
const globuyGlobals = {
  GlobuyWalker: 'readonly',
  GlobuyTranslator: 'readonly',
  GlobuyCurrency: 'readonly',
  GlobuySizes: 'readonly',
  GlobuySearch: 'readonly',
  GLOBUY_GLOSSARY: 'writable',
  GLOBUY_DEBUG: 'readonly'
};

module.exports = [
  { ignores: ['**/node_modules/**', '**/.wrangler/**', 'dist/**', '**/dist/**', '.claude/**'] },
  js.configs.recommended,
  {
    // Browser content scripts + background service worker.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        chrome: 'readonly',
        // Chrome built-in on-device AI.
        Translator: 'readonly',
        LanguageDetector: 'readonly',
        ...globuyGlobals
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // The detection regexes intentionally include non-ASCII whitespace
      // (NBSP, ideographic/fullwidth space) that these sites use in prices.
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipComments: true }]
    }
  },
  {
    // Cloudflare Worker proxy source (ESM, Workers runtime globals).
    files: ['proxy/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.serviceworker, ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    // Proxy unit tests (ESM, node:test).
    files: ['proxy/test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
    }
  },
  {
    // Node test suite.
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, WeakRef: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      // Retention tests deliberately null out references to make nodes collectable.
      'no-useless-assignment': 'off'
    }
  },
  {
    // Node ESM test suite.
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
    }
  },
  {
    // Node ESM build/dev scripts.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
    }
  }
];
