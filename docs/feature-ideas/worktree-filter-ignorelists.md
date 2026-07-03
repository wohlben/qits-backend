# Worktree file list: expose gitignored files (deferred Part 3)

## Introduction

Parts 1 & 2 of the original idea — the ordered white/blacklist rule model and dynamic ignorelist
filters — **have shipped**; see
[../features/2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md](../features/2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md).
This remaining draft is the **backend** half that was deliberately deferred: making the `/files`
endpoint return *everything* on disk, so the UI's rule list becomes the single, visible place
where hiding happens.

Related/dependent plans:

- Depends on the shipped filter pipeline (`shared/utils/filter-file-paths.ts`, the advanced dialog
  and dynamic `.gitignore` filter in `pattern/worktree/worktree-file-browser.component.ts`).
- The `.gitignore` **dynamic filter** already exists; today it only bites on gitignore patterns
  matching *tracked* files (git surfaces those via `--cached`). Once this change lands, it will
  also hide the now-visible ignored files — so it should become **enabled by default** when the
  worktree contains a `.gitignore`, keeping the out-of-the-box tree unchanged.

## The change

Today `WorktreeFilesService.listFiles` runs `git ls-files --cached --others --exclude-standard`,
so gitignored files (`node_modules/`, `dist/`, `.env`, …) never reach the UI. The guiding
principle is **everything is available, hidden only by rules**: hiding is a presentation concern
the user can inspect and override, not something silently baked into the data. So the browse
endpoint should be sourced from the **filesystem**, not git — cleanly separate from the git-backed
diff/parent-comparison endpoints, which continue to honour gitignore because their diff is
evaluated by git.

Two shapes were discussed:

- **Filesystem walk (preferred):** replace the `git ls-files` call with a working-tree walk that
  returns every file except `.git/`, unconditionally. Drops git from the browse endpoint entirely
  and matches the "filesystem source" separation. Diff endpoints stay git-based, untouched.
- **`includeIgnored=true` flag:** keep `git ls-files --cached --others` (drop only
  `--exclude-standard`) behind a query flag defaulting to today's behaviour. More conservative if
  the endpoint gains other consumers (agent tooling), but keeps it git-coupled.

To keep the default view unchanged after this lands, enable the `.gitignore` dynamic filter by
default when the worktree has one (seed it once per worktree, idempotently — e.g. an effect keyed
by `worktreeId`, so re-adding it after the user removes it is avoided).

### Size caveat

Without `--exclude-standard`, a worktree with `node_modules` or build output can return tens of
thousands of paths. Filtering itself is cheap (pure string passes over a flat array), but the file
tree renders every node into the DOM. With the default-on `.gitignore` filter the *rendered* tree
stays as small as today; only a user who deliberately disables it hits the large-DOM case. Still,
this change likely forces the deferred tree **virtual-scroll** work (and possibly capping/streaming
the `/files` payload).

### Worth noting / open questions

- Directory-only patterns (`foo/`) can't be distinguished from files by path string alone; the
  flat path list only contains files, so "match the dir" degrades to "match the prefix" — fine in
  practice (already how the shipped `ignorelistToRules` treats them).
- `WorktreeControllerTest`: with the ignored-files change, add a case where `/files` returns a
  file that `.gitignore` excludes (and, if the flag variant is chosen, that the default still
  hides it).
