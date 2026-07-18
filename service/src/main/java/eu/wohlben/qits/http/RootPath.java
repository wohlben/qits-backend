package eu.wohlben.qits.http;

/**
 * Normalizes {@code quarkus.http.root-path} for raw-router path arithmetic. Quarkus mounts the
 * route router under the root path, so route <em>patterns</em> stay relative — but {@code
 * rc.request().path()}/{@code normalizedPath()} return the full path, so any handler that parses
 * its path must strip the prefix first. Only non-{@code /} when qits itself runs as a managed
 * daemon (the qits-in-qits start script bridges {@code -Dquarkus.http.root-path}); the normal
 * deployment's root path is {@code /} and the prefix is empty.
 */
public final class RootPath {

  private RootPath() {}

  /** The strippable prefix: {@code ""} for root, else leading-slash, no trailing slash. */
  public static String prefix(String rootPath) {
    String p = rootPath == null || rootPath.isEmpty() ? "/" : rootPath;
    if (!p.startsWith("/")) {
      p = "/" + p;
    }
    return p.endsWith("/") ? p.substring(0, p.length() - 1) : p;
  }
}
