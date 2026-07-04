package eu.wohlben.qits.domain.daemon.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The shared definition of a "daemon" — a process a worktree runs that is <em>supposed to keep
 * running</em> (dev server, watch-mode test runner), whose result is a status over time rather than
 * an exit code. Deliberately shaped like {@code AbstractActionDefinition}: concrete subclasses pin
 * the scope ({@link DaemonConfiguration} global, {@link RepositoryDaemon} owned by a repository)
 * and map these fields into their own tables plus their own {@code environment} and {@code
 * observers} collection tables.
 */
@MappedSuperclass
public abstract class AbstractDaemonDefinition extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @Column(nullable = false)
  public String name;

  public String description;

  /** Run verbatim in the worktree; must stay in the foreground (the supervisor owns restarts). */
  @Column(name = "start_script", nullable = false, length = 4000)
  public String startScript;

  /**
   * Optional regex; the first match on the output stream flips STARTING → READY (e.g. {@code
   * Listening on.*:8080}). Without one, READY is assumed after a grace period.
   */
  @Column(name = "ready_pattern", length = 500)
  public String readyPattern;

  /** Signal name sent by a graceful stop before the kill fallback (e.g. TERM, INT). */
  @Column(name = "stop_signal", nullable = false, length = 32)
  public String stopSignal = "TERM";

  @Enumerated(EnumType.STRING)
  @Column(name = "restart_policy", nullable = false)
  public RestartPolicy restartPolicy = RestartPolicy.ON_FAILURE;

  /** How many relaunches the supervisor attempts before settling in CRASHED. */
  @Column(name = "max_restarts", nullable = false)
  public int maxRestarts = 3;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  public Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  public Instant updatedAt;
}
