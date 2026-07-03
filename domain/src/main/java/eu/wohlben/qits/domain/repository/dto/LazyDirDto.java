package eu.wohlben.qits.domain.repository.dto;

/**
 * A lazily-resolvable directory in a worktree's file tree — shown as a collapsed folder stub whose
 * contents are fetched on demand.
 *
 * @param path the directory path relative to the worktree root (no trailing slash)
 * @param childCount the number of <em>immediate</em> children (not total descendants — counting
 *     those would mean walking the very directory we are refusing to walk); drives the {@code
 *     node_modules/ (312)} label hint
 * @param href the {@code /files?path=…} endpoint URL that returns this directory's one-level
 *     listing, ready for the client to follow
 */
public record LazyDirDto(String path, int childCount, String href) {}
