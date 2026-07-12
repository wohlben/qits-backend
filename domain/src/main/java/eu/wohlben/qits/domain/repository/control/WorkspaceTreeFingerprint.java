package eu.wohlben.qits.domain.repository.control;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;

/**
 * The workspace's <em>structural</em> generation token: a hash of the sorted {@code git ls-files}
 * output (tracked + new untracked, gitignore honoured). It changes exactly when the set of tracked
 * paths changes — a file added, removed, or renamed — and stays put across pure content edits. Both
 * {@code /files} and {@code /detection} stamp it on their responses so the client can render tree +
 * detection <em>generation-consistent</em>: it applies detection only when its token matches the
 * files token it is showing, so the user never sees a skewed combination while the two independent
 * fetches settle.
 *
 * <p>Distinct from {@link WorkingTreeMarker}, which also moves on tracked-content edits
 * (freshness); this is deliberately structure-only so the token is stable while a file's
 * <em>contents</em> change.
 */
@ApplicationScoped
public class WorkspaceTreeFingerprint {

  @Inject WorkspaceFileAccess access;

  /**
   * Fetches {@code ls-files} and fingerprints it. Use when you don't already hold the path list.
   */
  public String compute(String repoId, String workspaceId) {
    return of(
        access
            .git(repoId, workspaceId, "ls-files", "--cached", "--others", "--exclude-standard")
            .lines()
            .filter(line -> !line.isBlank())
            .distinct()
            .sorted()
            .toList());
  }

  /**
   * Fingerprints an already-normalized ({@code ls-files} → blank-filtered, distinct, sorted) path
   * list, so a caller that already fetched it (the {@code /files} root, {@code DetectionService})
   * fingerprints without a second git call. The normalization must match {@link #compute} for the
   * two responses' tokens to agree on an identical tree.
   */
  public static String of(List<String> normalizedSortedPaths) {
    return WorkingTreeMarker.sha256(String.join("\n", normalizedSortedPaths));
  }
}
