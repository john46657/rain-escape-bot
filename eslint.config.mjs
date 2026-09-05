// @ts-check
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/**
 * ESLint-Konfiguration (Regel 48).
 *
 * Schwerpunkt liegt auf Regeln, die echte Fehler verhindern — nicht auf
 * Formatierung (das uebernimmt Prettier).
 */
export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**',
      '**/*.luau', 'apps/dashboard/.next/**',
      // Von Next.js generiert.
      'apps/dashboard/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: {
        console: 'readonly', process: 'readonly', Buffer: 'readonly', fetch: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        Headers: 'readonly', Request: 'readonly', Response: 'readonly',
        AbortController: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        NodeJS: 'readonly', window: 'readonly', document: 'readonly', WebSocket: 'readonly',
        HTMLInputElement: 'readonly', KeyboardEvent: 'readonly', RequestInit: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript uebernimmt diese Pruefungen bereits vollstaendig.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Sicherheitsrelevant: kein stillschweigendes `any` in Kernpfaden.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // Skripte und Tests duerfen auf die Konsole schreiben.
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'apps/bot/src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
