import { CodeReference, PickedSnippet } from './prompt-context.store';

// Built here in plain TS — never inline a fence into an Angular template (backticks inside
// inline templates break the template literal).
const FENCE = '```';

/**
 * Renders picked snippets as prompt text: a header naming the selector and page, the component
 * attribution when the pick carries one (file paths only — the agent runs in the workspace and
 * reads them itself), then the HTML in a fenced block (plus the open shadow root's content when
 * captured). Appended to an agent's initialContext or inserted into a chat draft.
 */
export function formatSnippetsForPrompt(snippets: PickedSnippet[]): string {
  return snippets
    .map((snippet) => {
      const parts = [
        'Picked element <' + snippet.tag + '> (selector: ' + snippet.selector + ') on ' + snippet.url + ':',
      ];
      if (snippet.appPath) {
        parts.push('App route: ' + snippet.appPath);
      }
      if (snippet.component) {
        parts.push(
          'Rendered by ' +
            snippet.component.className +
            ' (' +
            snippet.component.selector +
            ') — source files: ' +
            snippet.component.files.join(', '),
        );
        if (snippet.component.ancestors?.length) {
          parts.push('Enclosing components: ' + snippet.component.ancestors.join(', '));
        }
      }
      parts.push(FENCE + 'html', snippet.html, FENCE);
      if (snippet.shadowHtml) {
        parts.push('Its open shadow root contains:', FENCE + 'html', snippet.shadowHtml, FENCE);
      }
      if (snippet.styledHtml) {
        parts.push(
          'Optional style-frozen variant (the applied CSS inlined as style attributes — use it when styling matters, the original above is authoritative for structure):',
          FENCE + 'html',
          snippet.styledHtml,
          FENCE,
        );
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

/** `path:start` or `path:start-end` — the chip/row label and the chat dialog's insert form. */
export function codeReferenceLabel(ref: CodeReference): string {
  return ref.startLine === ref.endLine
    ? `${ref.path}:${ref.startLine}`
    : `${ref.path}:${ref.startLine}-${ref.endLine}`;
}

/**
 * Renders staged code references as prompt text: a "Selected code:" header plus one
 * `- path:start[-end]` bullet per reference. Paths and line ranges only, never file contents —
 * the agent runs inside the workspace and reads the files itself.
 */
export function formatReferencesForPrompt(refs: CodeReference[]): string {
  return ['Selected code:', ...refs.map((r) => '- ' + codeReferenceLabel(r))].join('\n');
}
