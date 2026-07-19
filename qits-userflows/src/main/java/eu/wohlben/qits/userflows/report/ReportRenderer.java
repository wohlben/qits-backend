package eu.wohlben.qits.userflows.report;

import java.io.IOException;
import java.nio.file.Path;

/**
 * Renders a {@link UserflowReport} into a story's report directory. {@link MarkdownReportRenderer}
 * is the default; future renderers (the artifacts publisher, part 2 of the epic) implement this
 * same interface over the canonical model rather than re-parsing the markdown.
 */
public interface ReportRenderer {

  /**
   * Emit this renderer's artifact(s) into {@code reportDir} (which already exists and holds the
   * captured media). Screenshot/video paths in {@code report} are relative to {@code reportDir}.
   */
  void render(UserflowReport report, Path reportDir) throws IOException;
}
