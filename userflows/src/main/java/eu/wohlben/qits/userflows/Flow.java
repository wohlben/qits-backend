package eu.wohlben.qits.userflows;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.assertions.PlaywrightAssertions;
import eu.wohlben.qits.userflows.report.Hashing;
import eu.wohlben.qits.userflows.report.Slugs;
import eu.wohlben.qits.userflows.report.UserflowReport;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;

/**
 * The step-recording facade over a Playwright {@link Page} that a {@link UserStory} drives. Its
 * verbs map 1:1 onto Playwright operations, and <b>every call appends a step line</b> to the
 * story's log — which is the whole point: Playwright-Java has no built-in step notion, so the
 * facade <i>is</i> the step mechanism. A story must therefore never touch the raw {@link Page}
 * except through {@link #page()} (which deliberately records nothing) — otherwise the report goes
 * blind.
 *
 * <p>Every step gets a stable string id: machine-assigned {@code step-NN} by default, or an
 * explicit author id via {@link #as(String)} ({@code flow.click("…").as("open-project")}) for a
 * meaningful, reorder-proof name. Screenshots link back to their step <b>by that id</b>.
 *
 * <p>Two parallel logs are kept: the <b>display</b> lines (with typed values) that become {@code
 * steps[]} in the sidecar and the indented block in the markdown, and a <b>fingerprint</b> (verbs +
 * selectors + labels, no dynamic values, no failure line) hashed into the deterministic {@link
 * #definitionHash()} — the future {@code qits.userflow.hash}, computed from what the story
 * <i>does</i> rather than from its source text. Step <i>ids</i> are labels, not part of that hash.
 *
 * <p>Instances are created by {@link UserStoryExtension}; stories only ever receive one as a method
 * parameter.
 */
public final class Flow {

  private final Page page;
  private final Path reportDir;
  private final String baseUrl;

  private final List<UserflowReport.Step> steps = new ArrayList<>();
  private final List<String> fingerprint = new ArrayList<>();
  // Screenshots are captured in memory and their files written at emit time (below), so an author's
  // .as(id) rename settles the owning step's id before the file name / link are derived from it.
  private final List<PendingShot> pendingShots = new ArrayList<>();

  Flow(Page page, Path reportDir, String baseUrl) {
    this.page = page;
    this.reportDir = reportDir;
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
  }

  // --- verbs ---------------------------------------------------------------------------------

  /**
   * Navigate to {@code urlOrPath}; a relative path resolves against the base URL, absolute (any
   * scheme, incl. {@code file://}) passes through unchanged.
   */
  public Flow navigate(String urlOrPath) {
    page.navigate(resolve(urlOrPath));
    return record("navigate " + urlOrPath, "navigate " + urlOrPath);
  }

  /** Wait for {@code selector} to appear (Playwright's default timeout). */
  public Flow waitFor(String selector) {
    page.waitForSelector(selector);
    return record("waitFor " + selector, "waitFor " + selector);
  }

  /** Wait for {@code selector} to appear, failing after {@code timeoutMillis}. */
  public Flow waitFor(String selector, double timeoutMillis) {
    page.waitForSelector(selector, new Page.WaitForSelectorOptions().setTimeout(timeoutMillis));
    return record("waitFor " + selector, "waitFor " + selector);
  }

  /** Click the first element matching {@code selector}. */
  public Flow click(String selector) {
    page.click(selector);
    return record("click " + selector, "click " + selector);
  }

  /**
   * Fill {@code selector} with {@code value} (the value shows in the report but not in the hash).
   */
  public Flow fill(String selector, String value) {
    page.fill(selector, value);
    return record("fill " + selector + " \"" + value + "\"", "fill " + selector);
  }

  /** Assert the element at {@code selector} contains {@code expected} text. */
  public Flow expectText(String selector, String expected) {
    PlaywrightAssertions.assertThat(page.locator(selector)).containsText(expected);
    return record("expectText " + selector + " \"" + expected + "\"", "expectText " + selector);
  }

  /** Capture the element matching {@code selector} into the report, labelled {@code label}. */
  public Flow screenshot(String selector, String label) {
    byte[] png = page.locator(selector).first().screenshot();
    capture(png, label);
    return record(
        "screenshot " + selector + " \"" + label + "\"",
        "screenshot " + selector + " \"" + label + "\"");
  }

  /** Capture the full page into the report, labelled {@code label}. */
  public Flow screenshot(String label) {
    byte[] png = page.screenshot(new Page.ScreenshotOptions().setFullPage(true));
    capture(png, label);
    return record("screenshot \"" + label + "\"", "screenshot \"" + label + "\"");
  }

  /**
   * Give the step just recorded an explicit id instead of the machine-assigned {@code step-NN} —
   * {@code flow.click("…").as("open-project")}. The id is what a screenshot on this step links to
   * and (for a screenshot step) its file-name prefix, so a meaningful id makes the report
   * self-describing and survives step reordering. Ids must be unique within the story and
   * file-name-safe ({@code [A-Za-z0-9] then [A-Za-z0-9._-]*}).
   */
  public Flow as(String id) {
    if (steps.isEmpty()) {
      throw new IllegalStateException("as() called before any step was recorded");
    }
    if (id == null || !id.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
      throw new IllegalArgumentException("step id must match [A-Za-z0-9][A-Za-z0-9._-]*: " + id);
    }
    // step-<n> is reserved for auto-assignment; allowing it would let a rename collide with the id
    // a LATER step will auto-receive (the uniqueness scan below can't see future steps).
    if (id.matches("step-\\d+")) {
      throw new IllegalArgumentException(
          "step id 'step-<n>' is reserved for auto-assignment: " + id);
    }
    int last = steps.size() - 1;
    for (int i = 0; i < steps.size(); i++) {
      if (i != last && steps.get(i).id().equals(id)) {
        throw new IllegalArgumentException("duplicate step id: " + id);
      }
    }
    steps.set(last, new UserflowReport.Step(id, steps.get(last).line()));
    return this;
  }

  /**
   * The raw Playwright {@link Page} — the documented escape hatch for genuinely exotic
   * interactions. Anything done through it leaves <b>no step record</b>; prefer the recording verbs
   * above.
   */
  public Page page() {
    return page;
  }

  // --- consumed by the extension to build the report -----------------------------------------

  List<UserflowReport.Step> steps() {
    return steps;
  }

  /**
   * Write each captured screenshot into the report dir and return the records — deferred to here so
   * every step id (including {@link #as(String)} overrides) is final before the file name and the
   * by-id link are derived from it.
   */
  List<UserflowReport.Screenshot> emitScreenshots() {
    List<UserflowReport.Screenshot> emitted = new ArrayList<>();
    for (PendingShot shot : pendingShots) {
      String stepId = steps.get(shot.stepIndex).id();
      String fileName = stepId + "-" + Slugs.slug(shot.label) + ".png";
      try {
        Files.write(reportDir.resolve(fileName), shot.png);
      } catch (IOException e) {
        throw new UncheckedIOException("failed to write screenshot " + fileName, e);
      }
      emitted.add(
          new UserflowReport.Screenshot(
              fileName, shot.label, stepId, shot.width, shot.height, shot.contentHash));
    }
    return emitted;
  }

  String definitionHash() {
    return Hashing.definitionHash(fingerprint);
  }

  /** Append the terminal failure as a final display step (never part of the fingerprint/hash). */
  void recordFailure(String message) {
    steps.add(new UserflowReport.Step(stepId(steps.size()), "FAILED: " + message));
  }

  // --- internals -----------------------------------------------------------------------------

  /** The default id for the step at {@code index}, e.g. {@code "step-05"}. */
  private static String stepId(int index) {
    return String.format("step-%02d", index);
  }

  private Flow record(String displayLine, String fingerprintLine) {
    steps.add(new UserflowReport.Step(stepId(steps.size()), displayLine));
    fingerprint.add(fingerprintLine);
    return this;
  }

  private void capture(byte[] png, String label) {
    // capture() runs before the screenshot step is recorded, so steps.size() is the index that step
    // will occupy; the file name + link are resolved from that step's (possibly .as()-renamed) id
    // at
    // emitScreenshots() time.
    int width = 0;
    int height = 0;
    var image = readImage(png);
    if (image != null) {
      width = image.getWidth();
      height = image.getHeight();
    }
    pendingShots.add(new PendingShot(steps.size(), label, png, width, height, Hashing.sha256(png)));
  }

  private static java.awt.image.BufferedImage readImage(byte[] png) {
    try {
      return ImageIO.read(new ByteArrayInputStream(png));
    } catch (IOException e) {
      return null; // dimensions fall back to 0; the file is still written
    }
  }

  private String resolve(String urlOrPath) {
    if (urlOrPath.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) {
      return urlOrPath; // absolute (http:, https:, file:, …)
    }
    return baseUrl + (urlOrPath.startsWith("/") ? "" : "/") + urlOrPath;
  }

  /** A screenshot captured in memory, awaiting its owning step's final id at emit time. */
  private record PendingShot(
      int stepIndex, String label, byte[] png, int width, int height, String contentHash) {}
}
