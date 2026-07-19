package eu.wohlben.qits.userflows.report;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.IOException;
import java.nio.file.Path;

/**
 * Writes the canonical {@code userflow.json} — the source of truth for every other renderer. Pretty
 * (2-space) so a story's sidecar is diff-friendly under review.
 */
public final class JsonReportWriter implements ReportRenderer {

  public static final String FILE_NAME = "userflow.json";

  private static final ObjectMapper MAPPER =
      new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

  @Override
  public void render(UserflowReport report, Path reportDir) throws IOException {
    MAPPER.writeValue(reportDir.resolve(FILE_NAME).toFile(), report);
  }
}
