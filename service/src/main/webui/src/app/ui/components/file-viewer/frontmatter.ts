/** A markdown source split into its leading YAML frontmatter (if any) and the document body. */
export interface ParsedFrontmatter {
  /** The raw YAML between the fences, or `null` when the file has no frontmatter block. */
  frontmatter: string | null;
  /** The document body: everything after the frontmatter (or the whole source when there is none). */
  body: string;
}

// --- EOL  <yaml>  EOL --- (EOL | end). Group 1 captures the YAML. Fences allow trailing
// spaces/tabs; EOLs are CRLF-safe. Only matches at the very start of the (BOM-stripped) source.
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits a markdown source into its leading YAML frontmatter block and the body.
 *
 * Frontmatter is the convention (Jekyll, Hugo, Obsidian, …) of opening a file with a `---` fence,
 * some YAML, and a closing `---` fence, all before the actual content. We only treat it as
 * frontmatter when the `---` is the very first thing in the file (an optional BOM aside) and a
 * matching closing fence exists — otherwise a document that legitimately opens with a `---`
 * horizontal rule would be mistaken for metadata. The YAML is captured verbatim, not parsed.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  // Ignore a leading UTF-8 BOM so a fence on the very first line still counts as frontmatter.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const match = FRONTMATTER.exec(text);
  if (!match) {
    return { frontmatter: null, body: source };
  }
  return {
    frontmatter: match[1],
    // Drop the block and any blank lines it leaves behind, so the body renders flush at the top.
    body: text.slice(match[0].length).replace(/^\s*\n/, ''),
  };
}
