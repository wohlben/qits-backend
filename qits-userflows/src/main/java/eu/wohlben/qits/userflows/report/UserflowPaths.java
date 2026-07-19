package eu.wohlben.qits.userflows.report;

import java.nio.file.Path;

/**
 * Resolves where reports land — {@code target/userstories/<slug>/} by default, overridable with the
 * {@code qits.userflows.output-dir} system property. Shared by the extension (which writes) and
 * {@link ReportAssertions} (which reads), so both agree on the layout.
 */
public final class UserflowPaths {

  public static final String OUTPUT_DIR_PROPERTY = "qits.userflows.output-dir";
  private static final String DEFAULT_OUTPUT_DIR = "target/userstories";

  private UserflowPaths() {}

  public static Path outputRoot() {
    return Path.of(System.getProperty(OUTPUT_DIR_PROPERTY, DEFAULT_OUTPUT_DIR));
  }

  public static Path reportDir(String slug) {
    return outputRoot().resolve(slug);
  }
}
