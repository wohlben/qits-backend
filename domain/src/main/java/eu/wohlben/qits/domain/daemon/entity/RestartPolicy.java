package eu.wohlben.qits.domain.daemon.entity;

/** What the supervisor does when a daemon's process exits on its own. */
public enum RestartPolicy {
  /** Never relaunch; a non-zero exit settles the instance in CRASHED. */
  NEVER,
  /** Relaunch only on a non-zero exit (up to {@code maxRestarts}); a clean exit stops it. */
  ON_FAILURE,
  /** Relaunch on any exit, clean or not (up to {@code maxRestarts}). */
  ALWAYS
}
