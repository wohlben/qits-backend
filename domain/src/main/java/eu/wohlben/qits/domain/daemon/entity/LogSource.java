package eu.wohlben.qits.domain.daemon.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/**
 * One additional log source of a daemon definition: a file in the worktree whose lines are tailed
 * ({@code tail -F} semantics) and fed to the daemon's observers alongside the process output. Every
 * daemon implicitly observes its process output; only FILE sources are stored, so this embeddable
 * carries no kind column. Stored as an element collection on each definition subclass (same split
 * as {@code observers}).
 */
@Embeddable
public class LogSource {

  /** Worktree-relative path of the tailed file; validated against traversal at definition time. */
  @Column(nullable = false, length = 1024)
  public String path;

  /** Optional display name shown instead of the path in feeds and messages. */
  @Column(length = 255)
  public String label;

  public LogSource() {}

  public LogSource(String path, String label) {
    this.path = path;
    this.label = label;
  }
}
