package eu.wohlben.qits.domain.daemon.api;

/**
 * The daemon's web-view configuration as submitted by clients. On update, a null block keeps the
 * stored config; a present block replaces both paths wholesale (a null path means "unset") while a
 * null {@code port} carries the stored port over. {@code port <= 0} clears the config — the daemon
 * stops being web-viewable. {@code entryPath} is the route the frame opens at below the served
 * base; {@code basePath} is the rare extra sub-path included in {@code $QITS_PUBLIC_BASE}.
 * Normalization and range/traversal validation happen in the domain service.
 */
public record WebViewInput(Integer port, String entryPath, String basePath) {

  /** The entryPath to pass to the service: block present ⇒ null fields replace as "unset". */
  String entryPathOrEmpty() {
    return entryPath == null ? "" : entryPath;
  }

  String basePathOrEmpty() {
    return basePath == null ? "" : basePath;
  }
}
