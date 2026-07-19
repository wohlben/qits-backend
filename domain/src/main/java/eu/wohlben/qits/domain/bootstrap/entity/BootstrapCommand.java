package eu.wohlben.qits.domain.bootstrap.entity;

import eu.wohlben.qits.domain.repository.entity.Repository;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One step of a repository's bootstrap chain — a one-shot command that takes a freshly provisioned
 * workspace container from bare checkout toward a runnable state (install dependencies, build, seed
 * demo data). The chain runs strictly in {@link #orderIndex} order after a fresh provision, before
 * daemon auto-start, and can be re-run on demand. Owned by (and only available in) one repository,
 * cascade-deleted with it (see {@code Repository#bootstrapCommands}).
 */
@Entity
@Table(name = "bootstrap_command")
public class BootstrapCommand extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "repository_id", nullable = false)
  public Repository repository;

  @Column(nullable = false)
  public String name;

  public String description;

  /** Run verbatim in the container at {@code /workspace}; its exit code decides the chain. */
  @Column(name = "execute_script", nullable = false, length = 4000)
  public String executeScript;

  /**
   * Optional "is this needed" guard, run before {@link #executeScript}: a non-zero exit skips the
   * command (recorded as SKIPPED, no command row). Idempotency stays the author's contract; this is
   * the escape hatch for steps that are expensive to repeat.
   */
  @Column(name = "check_script", length = 4000)
  public String checkScript;

  /**
   * Position in the repository's chain; commands run strictly ascending. Config-declared entries
   * are stamped from their file position on every ingest.
   */
  @Column(name = "order_index", nullable = false)
  public int orderIndex;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  public Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  public Instant updatedAt;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "bootstrap_command_env",
      joinColumns = @JoinColumn(name = "bootstrap_command_id"))
  @MapKeyColumn(name = "env_key")
  @Column(name = "env_value", length = 2000)
  public Map<String, String> environment = new HashMap<>();
}
