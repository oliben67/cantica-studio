// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // ── Ignore patterns ──────────────────────────────────────────────────────────
  { ignores: ['dist/**', 'node_modules/**', '*.vsix'] },

  // ── Base JS rules ────────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript (extension host + webview) ────────────────────────────────────
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow void for ignored promise returns (common in event handlers)
      '@typescript-eslint/no-floating-promises': 'off',
      // Some VS Code APIs return unknown; let TS strict mode handle it
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow non-null assertions where we've verified the value (sparingly)
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Unused vars: prefix with _ to suppress
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Consistent type imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },

  // ── React (webview only) ─────────────────────────────────────────────────────
  {
    files: ['webview-src/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX transform (React 17+) — no import needed
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── Extension host (Node/VS Code API) ────────────────────────────────────────
  {
    files: ['src/**/*.ts'],
    rules: {
      // void operator used to explicitly discard promises is common in VS Code
      'no-void': 'off',
    },
  },

  // ── Test files — relax a few rules ────────────────────────────────────────
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
