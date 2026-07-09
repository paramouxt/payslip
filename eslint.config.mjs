import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['node_modules/**', '.next/**', 'coverage/**', 'src/generated/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Domain code carries explanation trees; forbid stray console noise.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // ── Dependency direction: src/core is pure. ──────────────────────────
    // No framework, no persistence, no server code, no I/O libraries.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/*', '@/generated/*'], message: 'core must not know persistence' },
            { group: ['@/server/*'], message: 'core must not import the server layer' },
            {
              group: [
                '@/app/*',
                '@/features/*',
                '@/components/*',
                'react',
                'react-*',
                'next',
                'next/*',
              ],
              message: 'core must not import UI',
            },
            { group: ['@supabase/*'], message: 'core must not import vendor SDKs' },
          ],
        },
      ],
    },
  },
  {
    // ── src/server may not reach into UI. ────────────────────────────────
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/app/*',
                '@/features/*',
                '@/components/*',
                'react',
                'react-*',
                'next',
                'next/*',
              ],
              message: 'server layer must not import UI',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts', 'prisma/seed.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
