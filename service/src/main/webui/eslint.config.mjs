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
      // zard primitives are CLI-managed and inconsistent in selector style — most are kebab-case
      // attribute directives (e.g. `z-input`) but some are camelCase (e.g. `zPopover`). We don't
      // hand-edit vendored components, so the selector-style rule is off for this directory.
      '@angular-eslint/directive-selector': 'off',
      // Same reason: some vendored zard primitives (e.g. the dialog service/ref) use `any` in their
      // generic plumbing. We don't hand-edit them, so the rule is off for this directory.
      '@typescript-eslint/no-explicit-any': 'off',
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
