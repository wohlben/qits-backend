import type { PathFilter } from './filter-file-paths';

/**
 * Translates one gitignore-style ignore file's content into locality-scoped generated rules — the
 * heart of the "ignorelist" dynamic filter. `dir` is the directory that *contains* the ignore file
 * (`''` for the repo root); every generated rule is prefixed with it so patterns apply only to paths
 * **below** that directory, exactly like git. e.g. a `somepath/abc/.gitignore` line `somefile`
 * becomes `somepath/abc/**​/somefile`, hiding `somepath/abc/x/somefile` but not
 * `someotherpath/somefile`.
 *
 * Emitted rules use `kind: 'glob'` (gitignore-complete matching, case-sensitive at evaluation time)
 * and preserve line order so last-match-wins reproduces gitignore negation (`!pattern`) for free.
 * Translation:
 * - blank lines and `#` comments are skipped; `\#`/`\!` are literal `#`/`!`.
 * - leading `!` → `mode: 'whitelist'` (re-include), otherwise `blacklist`.
 * - trailing `/` → directory-only: match everything under that directory (`…/**`).
 * - a `/` at the start or middle → anchored to `dir`; a leading `/` is stripped.
 * - no `/` → matches the basename at any depth below `dir` (`**​/name`).
 */
export function ignorelistToRules(dir: string, content: string): PathFilter[] {
  const rules: PathFilter[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\s+$/, ''); // git ignores unescaped trailing whitespace
    if (line === '' || line.startsWith('#')) continue;

    let mode: PathFilter['mode'] = 'blacklist';
    if (line.startsWith('\\#') || line.startsWith('\\!')) {
      line = line.slice(1); // escaped leading '#'/'!' → literal
    } else if (line.startsWith('!')) {
      mode = 'whitelist';
      line = line.slice(1);
      if (line === '') continue;
    }

    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }

    const anchored = line.includes('/'); // leading or inner slash → relative to `dir`
    if (line.startsWith('/')) line = line.slice(1);

    const rel = anchored ? line : `**/${line}`;
    const scoped = dir === '' ? rel : `${dir}/${rel}`;
    const glob = dirOnly ? `${scoped}/**` : scoped;

    rules.push({ id: `ign:${dir}:${i}`, kind: 'glob', mode, query: glob, enabled: true });
  }
  return rules;
}
