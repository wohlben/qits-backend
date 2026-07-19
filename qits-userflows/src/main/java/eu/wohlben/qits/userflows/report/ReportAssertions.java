package eu.wohlben.qits.userflows.report;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Reading + asserting helpers over an emitted report — the framework's own self-test surface. A
 * harness story's {@code @AfterAll} companion uses these to prove the framework produced a
 * complete, consistent bundle. Lives in {@code src/main} (not {@code src/test}) so the
 * src/test-is-stories-only rule stays absolute: a story class carries no plumbing, only calls into
 * here.
 */
public final class ReportAssertions {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private ReportAssertions() {}

  /** Parse a story's canonical {@code userflow.json}. */
  public static UserflowReport read(String slug) {
    Path json = UserflowPaths.reportDir(slug).resolve(JsonReportWriter.FILE_NAME);
    try {
      return MAPPER.readValue(json.toFile(), UserflowReport.class);
    } catch (IOException e) {
      throw new UncheckedIOException("no readable " + json, e);
    }
  }

  /** The rendered {@code user-story.md} text. */
  public static String markdown(String slug) {
    try {
      return Files.readString(
          UserflowPaths.reportDir(slug).resolve(MarkdownReportRenderer.FILE_NAME),
          StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("no readable user-story.md for " + slug, e);
    }
  }

  /**
   * Assert a fully-formed passing report: the sidecar + markdown exist, the definition hash is
   * well-formed, every recorded step line appears (in order) in the markdown, each screenshot file
   * exists with plausible dimensions and a content hash, and {@code recording.webm} is non-empty.
   */
  public static void assertComplete(String slug, String expectedOutcome) {
    UserflowReport report = read(slug);
    Path dir = UserflowPaths.reportDir(slug);

    assertEquals(expectedOutcome, report.outcome(), "outcome");
    assertTrue(
        report.definitionHash().matches("sha256:[0-9a-f]{64}"),
        () -> "definition hash malformed: " + report.definitionHash());

    // Every step line appears in the markdown Steps section, in the recorded order. Start scanning
    // at the "## Steps" header so a step line that also occurs in the description can't satisfy it.
    String md = markdown(slug);
    int stepsHeader = md.indexOf("## Steps");
    assertTrue(stepsHeader >= 0, "user-story.md has no ## Steps section");
    int cursor = stepsHeader;
    for (UserflowReport.Step step : report.steps()) {
      int at = md.indexOf(step.line(), cursor);
      assertTrue(at >= 0, () -> "step missing or out of order in markdown: " + step.line());
      cursor = at + step.line().length();
    }

    for (UserflowReport.Screenshot shot : report.screenshots()) {
      Path png = dir.resolve(shot.path());
      assertTrue(Files.isRegularFile(png), () -> "missing screenshot " + png);
      assertTrue(shot.width() > 0 && shot.height() > 0, () -> "implausible dimensions " + shot);
      assertTrue(
          shot.contentHash().matches("sha256:[0-9a-f]{64}"),
          () -> "content hash malformed: " + shot.contentHash());
      // the link is by explicit step id and resolves to the screenshot step that produced it, not
      // inferred from position — so the association holds for a mid-story screenshot too
      UserflowReport.Step linked =
          report.steps().stream()
              .filter(step -> step.id().equals(shot.step()))
              .findFirst()
              .orElse(null);
      assertTrue(linked != null, () -> "screenshot references unknown step id: " + shot);
      assertTrue(
          linked != null && linked.line().startsWith("screenshot "),
          () -> "screenshot not linked to a screenshot step: " + shot);
    }

    if (report.video() != null) {
      Path webm = dir.resolve(report.video().path());
      assertTrue(sizeOf(webm) > 0, () -> "recording.webm missing or empty: " + webm);
    }
  }

  /**
   * Assert the failure path: {@code outcome: "failed"}, a partial step log (the steps that ran
   * before the failure), and an appended {@code FAILED: …} final step line.
   */
  public static void assertFailedWithPartialLog(String slug) {
    UserflowReport report = read(slug);
    assertEquals(UserflowReport.FAILED, report.outcome(), "outcome");
    assertTrue(
        report.steps().stream().anyMatch(step -> step.line().startsWith("FAILED:")),
        "expected an appended FAILED step line, got: " + report.steps());
    assertTrue(
        report.steps().stream().anyMatch(step -> !step.line().startsWith("FAILED:")),
        "expected at least one recorded step before the failure, got: " + report.steps());
  }

  /**
   * Assert some step carries the explicit id {@code id} (e.g. one assigned via {@code Flow.as}).
   */
  public static void assertStepId(String slug, String id) {
    UserflowReport report = read(slug);
    assertTrue(
        report.steps().stream().anyMatch(step -> step.id().equals(id)),
        () -> "no step with id '" + id + "' in " + report.steps());
  }

  /** Assert the markdown contains each of {@code substrings}. */
  public static void assertMarkdownContains(String slug, List<String> substrings) {
    String md = markdown(slug);
    for (String s : substrings) {
      assertTrue(md.contains(s), () -> "user-story.md missing expected text: " + s);
    }
  }

  private static long sizeOf(Path path) {
    try {
      return Files.isRegularFile(path) ? Files.size(path) : -1;
    } catch (IOException e) {
      return -1;
    }
  }
}
