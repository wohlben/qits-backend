package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.InternalServerErrorException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * A cheap fingerprint of a workspace's working-tree <em>state</em>, shared by every cache and the
 * file watcher that must decide "did anything meaningful change." {@code status --porcelain=v2
 * --branch -uall} carries the HEAD oid plus every dirty/untracked path, and {@code git diff} the
 * tracked files' content changes — together they move on any commit, edit, add or delete of a
 * tracked file and on the appearance/removal of an untracked one, but stay put for churn under a
 * gitignored path. (Its one blind spot: a content edit to an <em>already-untracked</em> file moves
 * neither, which is exactly a change no consumer here needs to react to.)
 *
 * <p>Distinct from {@link WorkspaceTreeFingerprint}: this moves on tracked-<em>content</em> edits
 * too (so it is the freshness/dedup signal), whereas the fingerprint is structure-only (the
 * render-consistency generation token).
 */
@ApplicationScoped
public class WorkingTreeMarker {

  @Inject WorkspaceFileAccess access;

  /** The marker for the workspace's current working tree. */
  public String compute(String repoId, String workspaceId) {
    String status =
        access.git(repoId, workspaceId, "status", "--porcelain=v2", "--branch", "-uall");
    String diff = access.git(repoId, workspaceId, "diff");
    return sha256(status + " " + diff);
  }

  static String sha256(String input) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(input.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new InternalServerErrorException("SHA-256 unavailable", e);
    }
  }
}
