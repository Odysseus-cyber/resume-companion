import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      'node_modules/**',
      '.output/**',
      '.wxt/**',
      '.dev/**',
      'public/licenses/**',
      'docs/licenses/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } } },
);
