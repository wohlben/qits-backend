package eu.wohlben.qits.userflows.report;

import java.util.Locale;

/** Kebab-case slugging, shared by report directory names and ordinal screenshot file names. */
public final class Slugs {

  private Slugs() {}

  /**
   * Lower-cases, replaces every run of non-alphanumeric characters with a single hyphen, and trims
   * leading/trailing hyphens. {@code "Create a greeting"} → {@code "create-a-greeting"}.
   */
  public static String slug(String text) {
    String slug =
        text.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-+|-+$)", "");
    return slug.isEmpty() ? "unnamed" : slug;
  }
}
