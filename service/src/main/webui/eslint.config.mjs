import tseslint from 'typescript-eslint';
import angularEslintPlugin from '@angular-eslint/eslint-plugin';
import angularEslintTemplatePlugin from '@angular-eslint/eslint-plugin-template';
import angularTemplateParser from '@angular-eslint/template-parser';
import localPlugin from './.pi/eslint-plugin/index.mjs';

export default tseslint.config(
  {
    files: ['**/*.ts'],
    ignores: ['src/app/api/**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    plugins: {
      '@angular-eslint': angularEslintPlugin,
      'qits-local': localPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      ...angularEslintPlugin.configs.recommended.rules,
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: ['app', 'z', 'zard'], style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['app', 'qits'], style: 'kebab-case' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'qits-local/no-inject-query-client': 'warn',
    },
  },
  {
    files: ['src/app/shared/components/**/*.ts'],
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['z', 'app'], style: 'kebab-case' },
      ],
      // zard primitives expose kebab-case attribute directives (e.g. `z-input`).
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: ['z', 'zard', 'app'], style: 'kebab-case' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    plugins: {
      '@angular-eslint/template': angularEslintTemplatePlugin,
    },
    languageOptions: {
      parser: angularTemplateParser,
    },
    rules: {
      ...angularEslintTemplatePlugin.configs.recommended.rules,
      ...angularEslintTemplatePlugin.configs.accessibility.rules,
    },
  },
);
