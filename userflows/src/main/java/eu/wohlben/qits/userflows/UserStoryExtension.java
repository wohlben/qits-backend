package eu.wohlben.qits.userflows;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.Video;
import eu.wohlben.qits.userflows.report.JsonReportWriter;
import eu.wohlben.qits.userflows.report.MarkdownReportRenderer;
import eu.wohlben.qits.userflows.report.ReportRenderer;
import eu.wohlben.qits.userflows.report.Slugs;
import eu.wohlben.qits.userflows.report.UserflowPaths;
import eu.wohlben.qits.userflows.report.UserflowReport;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;
import org.junit.jupiter.api.extension.AfterEachCallback;
import org.junit.jupiter.api.extension.BeforeEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.extension.ParameterContext;
import org.junit.jupiter.api.extension.ParameterResolutionException;
import org.junit.jupiter.api.extension.ParameterResolver;
import org.junit.jupiter.api.extension.TestExecutionExceptionHandler;

/**
 * The lifecycle owner of a {@link UserStory}: it launches a headless Chromium with video recording,
 * injects the recording {@link Flow}, records the outcome (including failures), and emits the
 * report ({@code userflow.json} + {@code user-story.md} + screenshots + {@code recording.webm})
 * under {@code target/userstories/<slug>/}.
 *
 * <p>Attached automatically via {@link UserStory @UserStory}'s {@code @ExtendWith}; stories never
 * reference it directly.
 *
 * <p>Base URL comes from {@code qits.userflows.base-url} (default {@code http://localhost:8080}); a
 * relative {@link Flow#navigate} resolves against it while absolute URLs (incl. {@code file://} for
 * the no-app harness stories) pass through.
 */
public final class UserStoryExtension
    implements BeforeEachCallback,
        ParameterResolver,
        TestExecutionExceptionHandler,
        AfterEachCallback {

  public static final String BASE_URL_PROPERTY = "qits.userflows.base-url";
  public static final String DEFAULT_BASE_URL = "http://localhost:8080";
  private static final int VIDEO_WIDTH = 1280;
  private static final int VIDEO_HEIGHT = 720;

  private static final ExtensionContext.Namespace NAMESPACE =
      ExtensionContext.Namespace.create(UserStoryExtension.class);
  private static final String STATE_KEY = "state";

  private static final List<ReportRenderer> RENDERERS =
      List.of(new JsonReportWriter(), new MarkdownReportRenderer());

  /** JVM-wide slug → story-name registry: two <i>different</i> stories slugging alike fail fast. */
  private static final Map<String, String> EMITTED_SLUGS = new ConcurrentHashMap<>();

  @Override
  public void beforeEach(ExtensionContext context) throws Exception {
    Method method = context.getRequiredTestMethod();
    UserStory story = method.getAnnotation(UserStory.class);
    if (story == null) {
      throw new IllegalStateException(
          "UserStoryExtension is only valid on @UserStory methods: " + method);
    }
    UserStoryDescription description = method.getAnnotation(UserStoryDescription.class);
    boolean expectFailure = method.isAnnotationPresent(ExpectedFailure.class);

    String name = story.value();
    String slug = Slugs.slug(name);
    checkForCollision(slug, name);
    Path reportDir = UserflowPaths.reportDir(slug);
    freshDirectory(reportDir);

    Path videoDir = reportDir.resolve(".video");
    Playwright playwright = createPlaywright();
    Browser browser = null;
    try {
      // if any of these throw, we must still tear down what was already created — otherwise the
      // driver + Chromium leak (afterEach can't help: no StoryState is stored yet)
      browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(true));
      BrowserContext browserContext =
          browser.newContext(
              new Browser.NewContextOptions()
                  .setViewportSize(VIDEO_WIDTH, VIDEO_HEIGHT)
                  .setRecordVideoDir(videoDir)
                  .setRecordVideoSize(VIDEO_WIDTH, VIDEO_HEIGHT));
      Page page = browserContext.newPage();
      Video video = page.video();

      String baseUrl = System.getProperty(BASE_URL_PROPERTY, DEFAULT_BASE_URL);
      Flow flow = new Flow(page, reportDir, baseUrl);

      StoryState state =
          new StoryState(
              name,
              slug,
              description == null ? null : description.value(),
              expectFailure,
              reportDir,
              videoDir,
              playwright,
              browser,
              browserContext,
              video,
              flow);
      context.getStore(NAMESPACE).put(STATE_KEY, state);
    } catch (RuntimeException | Error e) {
      closeQuietly(browser);
      closeQuietly(playwright);
      throw e;
    }
  }

  @Override
  public boolean supportsParameter(ParameterContext parameterContext, ExtensionContext context)
      throws ParameterResolutionException {
    return parameterContext.getParameter().getType() == Flow.class;
  }

  @Override
  public Object resolveParameter(ParameterContext parameterContext, ExtensionContext context)
      throws ParameterResolutionException {
    return state(context).flow;
  }

  @Override
  public void handleTestExecutionException(ExtensionContext context, Throwable throwable)
      throws Throwable {
    StoryState state = state(context);
    state.outcome = UserflowReport.FAILED;
    state.flow.recordFailure(messageOf(throwable));
    if (!state.expectFailure) {
      throw throwable; // a real story failure still fails the build
    }
    // @ExpectedFailure: swallow so the suite stays green — the failure path is what we're proving.
  }

  @Override
  public void afterEach(ExtensionContext context) throws Exception {
    StoryState state = state(context);
    if (state == null) {
      return; // beforeEach failed before storing state
    }
    try {
      finalizeVideoAndReport(state);
    } finally {
      closeQuietly(state.browser);
      closeQuietly(state.playwright);
    }
    if (state.expectFailure && !UserflowReport.FAILED.equals(state.outcome)) {
      throw new AssertionError(
          "@ExpectedFailure story '" + state.name + "' was expected to fail but passed");
    }
  }

  private void finalizeVideoAndReport(StoryState state) {
    // Video is best-effort: a story that recorded steps must always get its report, so a failure
    // finalizing the webm must not cost us userflow.json / user-story.md.
    UserflowReport.Video video = saveVideo(state);

    UserflowReport report =
        new UserflowReport(
            state.name,
            state.slug,
            state.description,
            List.copyOf(state.flow.steps()),
            state.flow.definitionHash(),
            state.flow.emitScreenshots(),
            video,
            state.outcome);

    try {
      for (ReportRenderer renderer : RENDERERS) {
        renderer.render(report, state.reportDir);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("failed to render report for '" + state.name + "'", e);
    }
  }

  /**
   * Finalize and save the recording (closing the context flushes the webm; {@code saveAs} blocks
   * until it is on disk), returning {@code null} rather than throwing if anything fails — the
   * report is written regardless. Duration is deliberately not emitted: Playwright exposes no webm
   * length and a wall-clock value would make the canonical sidecar differ on every run.
   */
  private static UserflowReport.Video saveVideo(StoryState state) {
    try {
      state.browserContext.close();
      if (state.video == null) {
        return null;
      }
      Path recording = state.reportDir.resolve("recording.webm");
      state.video.saveAs(recording);
      return new UserflowReport.Video(
          recording.getFileName().toString(), VIDEO_WIDTH, VIDEO_HEIGHT);
    } catch (RuntimeException e) {
      return null;
    } finally {
      deleteRecursively(state.videoDir); // drop Playwright's per-page temp dir
    }
  }

  private static void closeQuietly(AutoCloseable resource) {
    if (resource == null) {
      return;
    }
    try {
      resource.close();
    } catch (Exception ignored) {
      // best effort
    }
  }

  /**
   * Create Playwright, skipping its always-on browser <i>install</i> step when a browser is already
   * present (the baked {@code docker/workspace} image ships Chromium at {@code
   * PLAYWRIGHT_BROWSERS_PATH}). The Java driver otherwise re-runs {@code install} on every {@code
   * create()} and fails offline; skipping it makes it use the pinned baked browser. When no browser
   * is installed (local authoring on a bare machine) we leave the install enabled so it downloads.
   */
  private static Playwright createPlaywright() {
    Playwright.CreateOptions options = new Playwright.CreateOptions();
    if (browserAlreadyInstalled()) {
      options.setEnv(Map.of("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1"));
    }
    return Playwright.create(options);
  }

  private static boolean browserAlreadyInstalled() {
    String path = System.getenv("PLAYWRIGHT_BROWSERS_PATH");
    if (path == null || path.isBlank()) {
      return false;
    }
    Path dir = Path.of(path);
    if (!Files.isDirectory(dir)) {
      return false;
    }
    try (Stream<Path> entries = Files.list(dir)) {
      return entries.anyMatch(entry -> entry.getFileName().toString().startsWith("chromium-"));
    } catch (IOException e) {
      return false;
    }
  }

  private static void checkForCollision(String slug, String name) {
    String previous = EMITTED_SLUGS.putIfAbsent(slug, name);
    if (previous != null && !previous.equals(name)) {
      throw new IllegalStateException(
          "user-story slug collision: '"
              + name
              + "' and '"
              + previous
              + "' both slug to '"
              + slug
              + "' — rename one so their report directories don't overwrite each other");
    }
  }

  private static void freshDirectory(Path dir) throws IOException {
    deleteRecursively(dir);
    Files.createDirectories(dir);
  }

  private static void deleteRecursively(Path dir) {
    if (!Files.exists(dir)) {
      return;
    }
    try (Stream<Path> walk = Files.walk(dir)) {
      walk.sorted(Comparator.reverseOrder()).forEach(UserStoryExtension::deleteQuietly);
    } catch (IOException e) {
      throw new UncheckedIOException("failed to clean " + dir, e);
    }
  }

  private static void deleteQuietly(Path path) {
    try {
      Files.deleteIfExists(path);
    } catch (IOException ignored) {
      // best effort; a leftover file will simply be overwritten next run
    }
  }

  private static String messageOf(Throwable throwable) {
    String type = throwable.getClass().getSimpleName();
    String raw = throwable.getMessage();
    if (raw == null || raw.isBlank()) {
      return type;
    }
    String message = raw.replaceAll("\\s+", " ").strip();
    if (message.length() > 200) {
      message = message.substring(0, 199) + "…";
    }
    return type + ": " + message;
  }

  private static StoryState state(ExtensionContext context) {
    return context.getStore(NAMESPACE).get(STATE_KEY, StoryState.class);
  }

  /** Mutable per-story holder kept in the extension store. */
  private static final class StoryState {
    final String name;
    final String slug;
    final String description;
    final boolean expectFailure;
    final Path reportDir;
    final Path videoDir;
    final Playwright playwright;
    final Browser browser;
    final BrowserContext browserContext;
    final Video video;
    final Flow flow;
    volatile String outcome = UserflowReport.PASSED;

    StoryState(
        String name,
        String slug,
        String description,
        boolean expectFailure,
        Path reportDir,
        Path videoDir,
        Playwright playwright,
        Browser browser,
        BrowserContext browserContext,
        Video video,
        Flow flow) {
      this.name = name;
      this.slug = slug;
      this.description = description;
      this.expectFailure = expectFailure;
      this.reportDir = reportDir;
      this.videoDir = videoDir;
      this.playwright = playwright;
      this.browser = browser;
      this.browserContext = browserContext;
      this.video = video;
      this.flow = flow;
    }
  }
}
