import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'dist/**',
    'node_modules/**',
    '.shader-build/**',
    '.test-fixtures/**',
    '.blinc/**',
    'native/target/**',
    'src/**/generated/**',
  ]),
  {
    files: ['**/*.{js,mjs,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['tools/snapshot/viewer-client.mjs'],
    languageOptions: { globals: globals.browser },
  },
  // Prettier owns formatting. ESLint checks correctness and TypeScript usage.
  prettier,
  // Braces in all branches are compatible with Prettier.
  { rules: { curly: ['error', 'all'] } },
);
