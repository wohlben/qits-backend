# Workspace file browser: smart display of files (rendered views per file type)

## Introduction

The workspace file browser used to show every file the same way: a read-only CodeMirror
source view with syntax highlighting. This feature adds **smart display** — files whose type
has a richer natural presentation get a *rendered* view, starting with **`*.md` rendered as
HTML**. The source view never goes away: rendered and source are two modes of the same viewer
pane, with a toggle (GitHub's Preview/Code pattern), because the source view carries behaviour
the rendered view can't (line-range reference selection).

Implemented 2026-07-03: renderer registry + viewer host in `ui/components/file-viewer/`
(`renderers.ts`, `file-viewer.component.ts`, `markdown-file-renderer.component.ts`,
`resolve-relative-link.ts`), wired into the file browser. Deferred: heading anchors (marked
v18 emits no heading ids; `#…` links are swallowed instead of navigating away) and the
raw-bytes endpoint / image renderer listed under "future renderers".

Related/dependent plans:

- Extends the viewer pane of the
  [workspace-file-browser](./2026-07-02_workspace-file-browser.md)
  (`pattern/workspace/workspace-file-browser.component.ts`,
  `ui/components/code-viewer/code-viewer.component.ts`).
- Reuses the presentational `MarkdownComponent` built for
  [chat markdown rendering](./2026-07-02_chat-markdown-rendering.md) (`marked`,
  GFM, sanitized through Angular's `[innerHTML]` binding) — same component, new consumer.
- Independent of the filtering ideas
  ([workspace-filter-ignorelists](2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md),
  [workspace-tree-path-compaction](./2026-07-03_workspace-tree-path-compaction.md)) but shares
  the file-content query; a raw-bytes endpoint mentioned under "future renderers" would also
  unlock showing images that are currently a `binary` placeholder.

## Behaviour

- Opening a file whose type has a smart renderer shows the **rendered view by default**; a
  small mode toggle in the viewer header switches to the plain source view and back.
- Files without a renderer behave exactly as today (source view, no toggle).
- **References force source mode**: selecting line ranges (the `path:line` reference chips) is
  inherently a source-view interaction. The toggle is the escape hatch — jump to source, select
  lines, jump back. If a file already has collected references, the rendered view still opens
  by default; the chips remain visible either way. (Alternative — default to source when
  references exist — noted as an open question.)
- The chosen mode is remembered **per file type** for the session (a user reading through docs
  wants rendered everywhere; a user auditing markdown wants source everywhere), not per file.

## Design: a renderer registry, not an if-chain

A small registry mapping file patterns to renderer components keeps this open for the file
types that will inevitably follow:

```ts
// ui/components/file-viewer/renderers.ts
interface SmartRenderer {
  id: string;                      // 'markdown'
  matches(path: string): boolean;  // *.md, *.markdown
  component: Type<unknown>;        // rendered via NgComponentOutlet, input: content
}
```

- The viewer becomes a thin host: given `(path, content, binary)`, it resolves a renderer from
  the registry; if one matches it shows the toggle and defaults to the rendered component,
  otherwise it falls straight into the existing CodeMirror view. The CodeMirror component
  itself is untouched — smart display wraps it, it doesn't invade it.
- Registry entries live with the presentational components (`ui/`), the registry itself is a
  plain exported array — no DI ceremony needed until a renderer needs services.

### First renderer: markdown

- `matches`: `*.md`, `*.markdown` (case-insensitive on the extension).
- Renders through the existing `<app-markdown [text]="content">` — GFM, `marked`, sanitized by
  Angular's `DomSanitizer`. Repo content is untrusted (cloned repos, agent-written files), and
  that path is already the trust boundary the chat relies on; no new sanitization surface.
- Styling: the `.qits-md` styles were written to sit on chat bubbles; the viewer pane wants a
  document reading width (`max-width` ~ 80ch, comfortable padding) — likely a wrapper class
  around the same component rather than changes to it.

### Markdown-specific wrinkles (decide during implementation)

- **Relative links** (`[x](./other.md)`, `[y](../src/foo.ts)`): the natural behaviour is to
  resolve them against the current file's directory and open the target *in the file browser*
  (select the tree node) instead of navigating the SPA to a dead URL. Needs a click
  interceptor on the rendered HTML; absolute `http(s)` links open in a new tab as the chat
  does today.
- **Relative images** (`![](./diagram.png)`): can't render — image bytes aren't reachable
  (the content endpoint flags them `binary`, no payload). First iteration: let them 404
  gracefully (broken-image alt text). The fix is a raw-content endpoint, listed below.
- **Anchors** (`[](#section)`): in-pane scroll, needs `id`s on headings — `marked`'s GFM
  heading IDs cover this if enabled; low priority.

## Future renderers (out of scope, but the registry is shaped for them)

- **Images** (`*.png`, `*.svg`, `*.jpg`, …): needs a new backend endpoint
  (`GET .../files/raw?path=` streaming bytes with a content type, same symlink-containment
  checks as `/files/content`) since the current endpoint deliberately withholds binary
  content. This would also fix relative images inside rendered markdown, and turn today's
  "binary file" placeholder into an actual preview. SVG must be rendered via `<img>` (not
  inlined) so embedded scripts never execute.
- **Rich diffs later**: if the browser ever shows dirty/committed diffs, a rendered-markdown
  diff is explicitly *not* attempted — source view only, like GitHub.
- Candidates once wanted: CSV/TSV as a table, JSON pretty/collapsible view, Mermaid blocks
  inside markdown (needs a sandboxed renderer — security review first), HTML files (source
  only by default; rendering repo HTML executes nothing via sanitizer, so likely fine but
  low value).

## Open questions

- Default mode when a file already has reference chips: still rendered (consistent), or
  source (you were clearly working with lines)? Lean consistent-rendered; the toggle is one
  click.
- Should the top filter input / tree interactions be able to deep-link a markdown heading
  (e.g. selecting a `README.md` anchor from search)? Out of scope, noted for the future
  LSP/navigation work.
- Per-type mode memory: session-only (signal) suffices, or persist in `localStorage`? Start
  session-only.

## Testing sketch

- Registry unit test: `matches` per extension, case-insensitivity, first-match-wins if
  patterns ever overlap.
- Viewer host spec: `.md` file → markdown component rendered by default + toggle present;
  toggle → CodeMirror mounts (and line selection still emits references); `.ts` file → no
  toggle, source only; `binary` file → placeholder unchanged.
- Markdown renderer spec: relative link click selects the resolved tree path instead of
  navigating; external link keeps default behaviour; sanitization already covered by the
  existing `markdown.component.spec.ts`.
- Screenshot test (`*.browser.spec.ts`): rendered README in light + dark (the `.qits-md`
  styles were tuned for bubbles; this guards the reading-pane restyle).
