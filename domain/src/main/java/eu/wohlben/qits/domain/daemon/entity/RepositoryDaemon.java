package eu.wohlben.qits.domain.daemon.entity;

import eu.wohlben.qits.domain.repository.entity.Repository;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The definition of a "daemon" — a process a workspace runs that is <em>supposed to keep
 * running</em> (dev server, watch-mode test runner), whose result is a status over time rather than
 * an exit code. A daemon is essentially a long-running, non-interactive action, and like a
 * repository action it is owned by (and only available in) one repository — the dev server of the
 * project it serves — and cascade-deleted with it (see {@code Repository#daemons}). There is
 * deliberately no global daemon scope.
 */
@Entity
@Table(name = "repository_daemon")
public class RepositoryDaemon extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "repository_id", nullable = false)
  public Repository repository;

  @Column(nullable = false)
  public String name;

  public String description;

  /** Run verbatim in the workspace; must stay in the foreground (the supervisor owns restarts). */
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

  /**
   * Started automatically whenever a workspace container of this repository comes up (its dev
   * server is what the workspace exists to run), so opting <em>out</em> is the marked case —
   * default true.
   */
  @Column(name = "auto_start", nullable = false)
  public boolean autoStart = true;

  /** How many relaunches the supervisor attempts before settling in CRASHED. */
  @Column(name = "max_restarts", nullable = false)
  public int maxRestarts = 3;

  /**
   * When set, launches inject the {@code OTEL_EXPORTER_OTLP_*} environment so the process exports
   * telemetry to qits' in-process OTLP receiver, pre-tagged with workspace/repository/command ids.
   */
  @Column(nullable = false)
  public boolean otel;

  /**
   * When present, the daemon is web-viewable through the {@code /daemon/{workspaceId}/{daemonId}/}
   * proxy at the configured port/entry path. Hibernate reads an all-null embeddable back as null,
   * so null means not web-viewable.
   */
  @Embedded public WebView webView;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  public Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  public Instant updatedAt;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_daemon_env",
      joinColumns = @JoinColumn(name = "repository_daemon_id"))
  @MapKeyColumn(name = "env_key")
  @Column(name = "env_value", length = 2000)
  public Map<String, String> environment = new HashMap<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_daemon_observer",
      joinColumns = @JoinColumn(name = "repository_daemon_id"))
  @OrderColumn(name = "observer_index")
  public List<LogObserver> observers = new ArrayList<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_daemon_source",
      joinColumns = @JoinColumn(name = "repository_daemon_id"))
  @OrderColumn(name = "source_index")
  public List<LogSource> sources = new ArrayList<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_daemon_healthcheck",
      joinColumns = @JoinColumn(name = "repository_daemon_id"))
  @OrderColumn(name = "healthcheck_index")
  public List<HealthCheck> healthChecks = new ArrayList<>();
}
