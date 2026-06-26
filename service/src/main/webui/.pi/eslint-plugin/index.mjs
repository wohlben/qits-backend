/**
 * @fileoverview Local ESLint plugin for project-specific rules.
 */

/** @type {import('eslint').Rule.RuleModule} */
const noInjectQueryClient = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow injectQueryClient() in favor of inject(QueryClient)',
      recommended: true,
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      noInjectQueryClient:
        'Use inject(QueryClient) instead of injectQueryClient(). The helper is discouraged in this codebase.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'injectQueryClient'
        ) {
          context.report({
            node,
            messageId: 'noInjectQueryClient',
            suggest: [
              {
                desc: 'Replace with inject(QueryClient)',
                fix(fixer) {
                  return fixer.replaceText(node, 'inject(QueryClient)');
                },
              },
            ],
          });
        }
      },
    };
  },
};

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'qits-local',
    version: '0.0.1',
  },
  rules: {
    'no-inject-query-client': noInjectQueryClient,
  },
};

export default plugin;
