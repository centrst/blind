import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.ts', 'examples/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'ner/src/**/*.ts', 'ner/test/**/*.ts', 'ner/scripts/**/*.ts'],
  languageOptions: { parser: tseslint.parser },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    'no-debugger': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  },
});
