package eu.wohlben.qits.userflows;

/** Small URL helpers for extracting produced state (e.g. an entity id) from a page URL. */
public final class Urls {

  private Urls() {}

  /**
   * The last non-empty path segment of a URL, with any query/fragment stripped — e.g. {@code
   * "http://host/projects/abc-123"} → {@code "abc-123"}.
   */
  public static String lastPathSegment(String url) {
    String path = url.split("[?#]", 2)[0];
    while (path.endsWith("/")) {
      path = path.substring(0, path.length() - 1);
    }
    int slash = path.lastIndexOf('/');
    return slash >= 0 ? path.substring(slash + 1) : path;
  }
}
