// Flat config (ESLint 9+). Correctness-focused only — no style/formatting
// rules, since those are a separate, lower-value concern for this project
// and would just cause churn against the existing code's style.
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.worker, // src/, worker.js — Cloudflare Workers runtime
        ...globals.browser, // public/js/*.js — client-side scripts
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['node_modules/**', 'public/css/**', 'public/cheatsheets/**'],
  },
];
