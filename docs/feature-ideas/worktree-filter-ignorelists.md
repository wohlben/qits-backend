# Worktree file-tree filtering: ordered white/blacklist rules + dynamic ignorelist filters

## Introduction

Extends the advanced filter dialog of the worktree file browser
([2026-07-02_worktree-file-browser.md](../features/2026-07-02_worktree-file-browser.md)) in two
steps: first the filter model is generalized from "includes union minus excludes" to an **ordered
rule list** where every rule carries a `whitelist`/`blacklist` mode; then, on top of that model,
**dynamic filters** are introduced — rule sets that are derived automatically from worktree
content, starting with **ignorelists** (`.gitignore`-style files found in the file list). A third
part moves gitignore-hiding out of the backend: the file list returns *everything* (the guiding
principle: all files are available, hidden only by visible, overridable rules), with the
`.gitignore` dynamic filter enabled by default so the default view is unchanged.

Related/dependent plans:

- Builds directly on the filter pipeline of
  [worktree-file-browser](../features/2026-07-02_worktree-file-browser.md)
  (`shared/utils/filter-file-paths.ts`, the advanced dialog in
  `pattern/worktree/worktree-file-browser.component.ts`).
- Uses the existing `GET .../{worktreeId}/files/content` endpoint to read ignore-file contents.
- One backend change (Part 3): the `/files` endpoint stops pre-hiding gitignored files, so the
  UI's rules become the single place where hiding happens.
- The programmatic filter API (`setFilters`/`addFilter`/…) that was left as a public surface "to
  be populated in code later" is the natural integration point for the dynamic rules.

## Part 1 — generalize the filter model: mode + order

Today `PathFilter` has four kinds, one of which (`excludes`) is really a *mode* smuggled in as a
kind. Restructure:

```ts
interface PathFilter {
  id: string;
  kind: 'exact' | 'fuzzy' | 'includes';   // how to match
  mode: 'whitelist' | 'blacklist';         // what a match means
  order: number;                           // evaluation position
  query: string;
  enabled: boolean;
}
```

- **`kind`** keeps describing *how* the query matches a path. The `excludes` kind is removed —
  it becomes `kind: 'includes', mode: 'blacklist'`. (A one-time migration in the component is
  trivial since filters are in-memory only.)
- **`mode`** says whether a match makes the path visible or hidden.
- **`order`** makes the list a sequence. Evaluation is gitignore-style **last-match-wins**: walk
  the rules in order; the last rule that matches a path decides its fate. Paths matched by no
  rule fall back to a default: *visible* when the list contains no whitelist rules (pure
  blacklist behaves like today's excludes-only case), *hidden* as soon as at least one whitelist
  rule exists (today's union-of-includes behaviour). This keeps both current behaviours as
  special cases while enabling new ones — e.g. "hide `dist/`, but whitelist
  `dist/config.json` back in" by placing the whitelist rule after the blacklist rule.
- **Dialog UI**: each row gains a mode toggle (e.g. a small whitelist/blacklist segmented
  control or icon toggle) and the rows become reorderable (up/down buttons are enough; drag &
  drop is a nice-to-have). The live "visible files (N)" preview keeps working unchanged.

## Part 2 — dynamic filters

A second button in the advanced dialog, next to "add filter": **"add dynamic filter"**. Where a
normal rule is authored by the user, a dynamic filter is a *generator*: it derives a set of
`PathFilter`-shaped rules from the current worktree content and re-derives them whenever that
content changes.

### Separate rule list

Dynamic rules live in their **own list**, separate from the manual filters — they are recreated
on every relevant change (file list refetch, ignore-file content change), so they must never be
hand-edited or mixed into the manual list where user edits would be silently thrown away.

- The component holds `filters` (manual, as today) and `dynamicFilters: DynamicFilter[]`, where
  a `DynamicFilter` is the *selection* (e.g. `{ id, type: 'ignorelist', param: '.gitignore',
  enabled }`) and its generated rules are a `computed()` over the file list + fetched contents.
- Pipeline: generated dynamic rules apply first, then the manual rule list, then the top
  filename input — so a manual whitelist rule can always resurrect something an ignorelist hid.
- In the dialog, dynamic filters render as their own section: one collapsed row per selected
  dynamic filter with an enable toggle and a remove button; expanding it shows the generated
  rules **read-only** (useful for debugging why a file disappeared).

### First dynamic filter: ignorelists

- **Availability**: offered only when the file list contains at least one file whose basename
  matches `.*ignore` (`.gitignore`, `.dockerignore`, `.eslintignore`, …). The existing wildcard
  matcher (`fuzzyMatch` with glob) already implements exactly this pattern.
- **Choices**: the "add dynamic filter → ignorelists" picker lists the distinct **basenames**,
  deduplicated — a repo with five nested `.gitignore` files shows a single `.gitignore` entry.
- **Selecting one** (e.g. `.gitignore`) means: for *every* file in the worktree with that
  basename, fetch its content (`/files/content`, cached via TanStack Query per path) and
  translate each pattern line into generated blacklist/whitelist rules.

#### Locality — the crucial semantic

Patterns in an ignore file apply **only below the directory containing that file**, exactly like
git. If `somepath/abc/.gitignore` contains `somefile`, then `somepath/abc/**/somefile` is
hidden, but `someotherpath/somefile` stays visible. Concretely, each generated rule is scoped by
prefixing the ignore file's directory:

- pattern without `/` (e.g. `somefile`) → matches that basename anywhere *under* the ignore
  file's dir → `<dir>/**/somefile`
- pattern with a leading or inner `/` (e.g. `/build`, `src/gen`) → anchored to the ignore
  file's dir → `<dir>/build`, `<dir>/src/gen`
- trailing `/` → directory-only: match the dir and everything under it
- `!pattern` → same translation but `mode: 'whitelist'`, preserving line order
  (last-match-wins makes gitignore negation fall out of the Part 1 semantics for free)
- `*`, `?`, `**`, character classes → needs a proper gitignore-glob matcher; the current
  `wildcardToRegExp` is close but not gitignore-complete (no `**` vs `*` distinction, no
  `[a-z]`). Likely a new `kind: 'glob'` (or an internal matcher used only by generated rules)
  rather than stretching `fuzzy` further.
- comments (`#`) and blank lines are skipped; escaped `\#`/`\!` handled literally.

#### Recreation

Generated rules are a pure function of (file list, ignore-file contents). When the file list
refetches (an agent added files, an ignore file appeared/disappeared) or an ignore file's
content changes, the derived rules recompute automatically — `computed()` over the query
results gives this for free. Nothing about a dynamic filter is persisted per-rule; only the
selection (`ignorelists: .gitignore`) is state.

## Part 3 — backend: expose gitignored files

Today the file list runs `git ls-files --cached --others --exclude-standard`, so gitignored
files never reach the UI — which would make the `.gitignore` dynamic filter mostly a no-op. The
guiding principle for this UI is **everything is available, hidden only by rules**: hiding is a
presentation concern the user can inspect and override, not something silently baked into the
data. So:

- `/files` drops `--exclude-standard` (i.e. `git ls-files --cached --others`), returning every
  file in the working tree except `.git` itself. Ignored-but-present files (`node_modules/`,
  `dist/`, `.env`, …) now appear in the payload.
- To keep the *default view* unchanged, the worktree browser adds the `.gitignore` **dynamic
  filter enabled by default** when the worktree contains any `.gitignore`. The out-of-the-box
  tree looks exactly like today — but now the user can open the dialog, toggle that dynamic
  filter off (or whitelist a path past it with a manual rule), and see what git hides.
- This is also what gives the dynamic-filter feature its teeth: the backend stops duplicating
  ignore logic, and the UI's rule list becomes the single, visible source of truth for why any
  file is or isn't shown.
- **Size caveat**: without `--exclude-standard`, a worktree with `node_modules` or build output
  can return tens of thousands of paths. The file-browser doc already flags that the whole tree
  is rendered into the DOM; this change likely forces that deferred work (tree virtual scroll,
  and possibly capping/streaming the `/files` payload). Filtering itself is cheap (pure string
  passes over a flat array), but the DOM is not.
- API-wise this can be unconditional or an `includeIgnored=true` query flag defaulting to
  today's behaviour — the flag is the conservative choice since the endpoint has other
  potential consumers (agent tooling later), and the browser simply always passes it.

### Worth noting / open questions

- Directory-only patterns (`foo/`) can't be distinguished from files by path string alone; the
  flat path list only contains files, so "match the dir" degrades to "match the prefix" — fine
  in practice.
- Precedence between multiple ignore files of the same basename in nested dirs: git applies
  deeper files after shallower ones; ordering generated rules by directory depth (shallow →
  deep), preserving line order within a file, replicates that.
- Does `order` need to be an explicit field, or is array position enough? Array position is
  simpler and the dialog already renders a list; an explicit field only pays off if rules are
  ever persisted/merged. Lean towards array position, keep `order` out of the model.

## Testing sketch

- `filter-file-paths.spec.ts`: last-match-wins ordering, default visibility with/without
  whitelist rules, blacklist-then-whitelist resurrection.
- New `ignorelist-rules.spec.ts` (pure util): pattern translation table — plain name, anchored,
  trailing slash, negation, `**`, comments — each asserted against the locality example from
  this doc (`somepath/abc/.gitignore` containing `somefile` hides
  `somepath/abc/x/somefile` but not `someotherpath/somefile`).
- Component spec: dynamic filter availability (`.*ignore` present/absent), basename dedupe,
  regeneration when the mocked content query changes, that manual rules still apply after
  dynamic ones, and that the `.gitignore` dynamic filter is auto-added enabled when the file
  list contains one.
- `WorktreeControllerTest`: `/files` with the ignored-files flag returns a file that
  `.gitignore` excludes (and without the flag keeps today's behaviour, if the flag variant is
  chosen).
