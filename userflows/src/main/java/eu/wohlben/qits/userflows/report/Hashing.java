package eu.wohlben.qits.userflows.report;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * SHA-256 helpers producing the {@code sha256:<hex>} form used throughout the report — the
 * definition hash (over the step lines) and each screenshot's content hash. The prefixed form is
 * what the future artifacts uploader stamps as {@code qits.userflow.hash} / {@code qits.diff.hash}.
 */
public final class Hashing {

  private Hashing() {}

  /**
   * {@code sha256:<hex>} over the joined step lines — the story's deterministic definition hash.
   */
  public static String definitionHash(List<String> steps) {
    return sha256(String.join("\n", steps).getBytes(StandardCharsets.UTF_8));
  }

  /** {@code sha256:<hex>} over raw bytes — a screenshot's content hash. */
  public static String sha256(byte[] bytes) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
      return "sha256:" + HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 unavailable", e); // never on a standard JRE
    }
  }
}
