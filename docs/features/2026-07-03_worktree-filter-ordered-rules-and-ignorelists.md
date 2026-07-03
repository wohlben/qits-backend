# Worktree file-tree filtering: ordered white/blacklist rules + dynamic ignorelist filters

## Introduction

Extends the advanced filter dialog of the worktree file browser
([2026-07-02_worktree-file-browser.md](2026-07-02_worktree-file-browser.md)) in two steps: the
filter model is generalized from "includes union minus excludes" to an **ordered rule list**
evaluated gitignore-style (last-match-wins, each rule whitelist/blacklist), and on top of it
**dynamic filters** are added — rule sets derived automatically from worktree content, starting
with **ignorelists** (`.gitignore`-style files found in the file list).

Related/dependent plans:

- Builds on the filter pipeline of
  [worktree-file-browser](2026-07-02_worktree-file-browser.md)
  (`shared/utils/filter-file-paths.ts`, the advanced dialog in
  `pattern/worktree/worktree-file-browser.component.ts`).
- **Part 3 of the original idea is deferred** — see
  [../feature-ideas/worktree-filter-ignorelists.md](../feature-ideas/worktree-filter-ignorelists.md):
  the `/files` endpoint still runs `git ls-files … --exclude-standard`, so gitignored files stay
  out of the payload for now. Because git still hides them, there is no default-on `.gitignore`
  filter — dynamic filters are entirely user-added. The `.gitignore` dynamic filter still does
  real work on gitignore patterns that match *tracked* files git surfaces via `--cached` (and on
  non-git ignore files like `.dockerignore`/`.eslintignore`).

## What was built

### Part 1 — generalized filter model (`shared/utils/filter-file-paths.ts`)

`PathFilter` gains a `mode: 'whitelist' | 'blacklist'`; the old `excludes` kind is dropped
(migrated to `includes` + `blacklist`). A generated-only `glob` kind carries gitignore-complete
patterns (`gitignoreGlobToRegExp`: `**` crosses `/`, `*` stays in a segment, `?`, `[a-z]`/`[!x]`).

`applyPathFilters` is now **last-match-wins** over the ordered list (array position *is* the
order). The default for unmatched paths is set by the **first** active rule's stance:

- lead with a **manual whitelist** → default hidden (legacy "show only these"; a trailing
  blacklist then subtracts, reproducing the old includes-minus-excludes).
- lead with a **blacklist** → default visible, so everything shows except what a blacklist hides,
  and a later whitelist can re-include one path without hiding the rest (gitignore's
  `foo` + `!foo/keep`, and the resurrection flow for dynamic filters).

A generated `glob` whitelist never sets the stance, so an ignore file that opens with a
`!negation` can't flip the whole tree to hidden.

> Note: this "first rule sets the stance" rule is a deliberate refinement of the original idea's
> "any whitelist flips the default" — the latter made adding a manual whitelist to resurrect one
> ignored file hide the entire rest of the tree, defeating the headline flow.

The dialog rows gain a **Show/Hide mode toggle** and **up/down reorder** buttons; the manual kind
dropdown offers Exact/Fuzzy/Includes (glob is generated-only). The live "Visible files (N)"
preview is unchanged.

### Part 2 — dynamic ignorelist filters

- New pure util `shared/utils/ignorelist-rules.ts`: `ignorelistToRules(dir, content)` translates
  an ignore file's patterns into **locality-scoped** generated rules (prefixed with the ignore
  file's directory, so patterns apply only below it — exactly like git). Handles plain names
  (`**/name`), anchored (`/x`, `a/b`), trailing-slash directories (`…/**`), negation (`!` →
  whitelist), comments, and `\#`/`\!` escapes.
- The component holds `dynamicFilters: DynamicFilter[]` (the *selection*, e.g.
  `{ type: 'ignorelist', param: '.gitignore' }`); the generated rules are a `computed()` over the
  file list + the fetched ignore-file contents, so they re-derive whenever either changes.
- Contents of *every* file with the selected basename are fetched reactively via `injectQueries`
  (dynamic count), reusing the viewer's `['worktree-file', repoId, worktreeId, path]` query key so
  an ignore file opened in the viewer and used as a filter is a single request.
- Pipeline: generated dynamic rules first, then the manual list, then the top filename input —
  `effectiveFilters = [...generatedDynamicRules, ...filters]` — so a manual whitelist always wins
  last and can resurrect a dynamically-hidden path.
- Dialog: a "Dynamic filters" section with one row per selection (enable toggle, remove, and an
  expander showing the generated rules **read-only**), plus an "Add dynamic filter" picker listing
  the distinct `.*ignore` basenames present (de-duplicated; disabled when none remain).

## Testing

- `filter-file-paths.spec.ts` — `gitignoreGlobToRegExp` (`**` vs `*`, `?` not crossing `/`,
  classes), last-match-wins ordering, first-rule default stance, blacklist-then-whitelist
  resurrection, order-reversal flipping the outcome.
- `ignorelist-rules.spec.ts` — the pattern translation table + the doc's locality example
  (`somepath/abc/.gitignore` with `somefile` hides `somepath/abc/x/somefile` but not
  `someotherpath/somefile`).
- `worktree-file-browser.component.spec.ts` — legacy `excludes` migration, mode toggle + reorder,
  dynamic-filter availability/dedupe, rule generation + regeneration on content change, and a
  manual whitelist resurrecting a dynamically-hidden file.
- Verified end-to-end in the running app (headless browser): added a `.gitignore` (`*.txt` +
  `!hello.txt`) to a demo worktree; the picker offered it, selecting it hid `feature.txt`/
  `random.txt` while `hello.txt` survived via the negation, and the read-only rule view showed
  `HIDE **/*.txt` / `SHOW **/hello.txt`.
