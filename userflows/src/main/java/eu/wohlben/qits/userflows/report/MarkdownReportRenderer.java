package eu.wohlben.qits.userflows.report;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * The default renderer: turns a {@link UserflowReport} into the human-facing {@code user-story.md}
 * — description, the recorded steps with each screenshot interleaved beneath its own step, and a
 * link to the video. It consumes the model only (never the live run) and never emits frontmatter,
 * so the document stays a portable, readable bundle alongside its relative-linked media.
 */
public final class MarkdownReportRenderer implements ReportRenderer {

  public static final String FILE_NAME = "user-story.md";

  @Override
  public void render(UserflowReport report, Path reportDir) throws IOException {
    StringBuilder md = new StringBuilder();
    md.append("# ").append(report.story()).append("\n");

    if (report.description() != null && !report.description().isBlank()) {
      md.append("\n## User flow\n\n").append(report.description().strip()).append("\n");
    }

    // Steps render as an indented (code-block) list, with each screenshot interleaved directly
    // beneath the step that produced it — the image follows its own step by construction, so a
    // mid-story screenshot lands in the right place, not lumped at the end.
    Map<String, UserflowReport.Screenshot> byStep = new HashMap<>();
    for (UserflowReport.Screenshot shot : report.screenshots()) {
      byStep.put(shot.step(), shot);
    }
    md.append("\n## Steps\n\n");
    for (UserflowReport.Step step : report.steps()) {
      md.append("    ").append(step.line()).append("\n"); // 4-space indent = code block
      UserflowReport.Screenshot shot = byStep.get(step.id());
      if (shot != null) {
        // blank lines close the code block before the image and reopen it for the next step
        md.append("\n![").append(shot.label()).append("](").append(shot.path()).append(")\n\n");
      }
    }

    if (report.video() != null) {
      startSection(md)
          .append("## Video\n\n[")
          .append(report.video().path())
          .append("](")
          .append(report.video().path())
          .append(")\n");
    }

    if (UserflowReport.FAILED.equals(report.outcome())) {
      startSection(md).append("> **Outcome: failed** — see the final step line above.\n");
    }

    Files.writeString(reportDir.resolve(FILE_NAME), md.toString(), StandardCharsets.UTF_8);
  }

  /**
   * Trim trailing blank lines and re-add exactly one, so a section starts cleanly after whatever
   * the step interleaving left behind — without a global collapse that would mangle intentional
   * blank runs in the verbatim description.
   */
  private static StringBuilder startSection(StringBuilder md) {
    while (md.length() > 0 && md.charAt(md.length() - 1) == '\n') {
      md.setLength(md.length() - 1);
    }
    return md.append("\n\n");
  }
}
