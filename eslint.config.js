// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      '**/*.d.ts',
      'sidecar/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // CLAUDE.md: không dùng `any` — bí thì `unknown` + type guard
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Không nuốt lỗi trong catch rỗng
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Renderer không được import module Node
    files: ['apps/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: 'Renderer không được dùng fs — gọi qua window.api.*' },
            { name: 'node:fs', message: 'Renderer không được dùng fs — gọi qua window.api.*' },
            { name: 'path', message: 'Renderer không được dùng path — gọi qua window.api.*' },
            { name: 'node:path', message: 'Renderer không được dùng path — gọi qua window.api.*' },
            {
              name: 'child_process',
              message: 'Renderer không được spawn process — gọi qua window.api.*',
            },
            {
              name: 'node:child_process',
              message: 'Renderer không được spawn process — gọi qua window.api.*',
            },
            { name: 'electron', message: 'Renderer chỉ dùng API expose qua preload' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
