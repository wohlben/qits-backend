package eu.wohlben.qits.userflows;

import java.net.URL;

/**
 * Turns a bundled classpath resource into a navigable {@code file://} URL — the framework support
 * for no-app <b>harness stories</b>, which drive a static HTML page shipped as a test resource
 * instead of a running app. Generic on purpose (any bundled page), so it belongs in the framework
 * rather than in a story.
 */
public final class HarnessResources {

  private HarnessResources() {}

  /** The {@code file://} URL of a classpath resource (e.g. {@code "/harness/greeting.html"}). */
  public static String classpathUrl(String resource) {
    URL url = HarnessResources.class.getResource(resource);
    if (url == null) {
      throw new IllegalArgumentException("no classpath resource: " + resource);
    }
    return url.toString();
  }
}
