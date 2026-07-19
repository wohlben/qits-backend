package eu.wohlben.qits.userflows;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

/**
 * The app-under-test target for stories that drive a running qits. Stories which need a live app
 * are {@code *IT} classes gated behind {@code -Pextended} and <b>self-skip</b> when nothing answers
 * — exactly like {@code WorkspaceContainerIT} — so a default build (and an {@code -Pextended} build
 * on a machine with no qits running) stays green. Guard such a story with:
 *
 * <pre>{@code
 * @BeforeAll
 * static void requireQits() {
 *   assumeTrue(UserflowTarget.isReachable(), () -> "qits not reachable at " + UserflowTarget.baseUrl());
 * }
 * }</pre>
 */
public final class UserflowTarget {

  private UserflowTarget() {}

  /**
   * The configured base URL ({@code qits.userflows.base-url}, default {@code
   * http://localhost:8080}).
   */
  public static String baseUrl() {
    return System.getProperty(
        UserStoryExtension.BASE_URL_PROPERTY, UserStoryExtension.DEFAULT_BASE_URL);
  }

  /** Whether an HTTP GET to {@link #baseUrl()} answers within a short timeout. */
  public static boolean isReachable() {
    try {
      URL url = URI.create(baseUrl()).toURL();
      HttpURLConnection connection = (HttpURLConnection) url.openConnection();
      connection.setConnectTimeout(1500);
      connection.setReadTimeout(1500);
      connection.setRequestMethod("GET");
      try {
        return connection.getResponseCode() > 0;
      } finally {
        connection.disconnect();
      }
    } catch (IOException e) {
      return false;
    }
  }
}
