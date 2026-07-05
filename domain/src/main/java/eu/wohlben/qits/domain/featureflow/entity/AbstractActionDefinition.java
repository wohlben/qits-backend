package eu.wohlben.qits.domain.featureflow.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The shared definition of an "action" — a preconfigured process a workspace can run — independent
 * of where it lives. Concrete subclasses pin the scope: {@link ActionConfiguration} is global,
 * {@link RepositoryAction} is owned by a repository. Each subclass maps these fields into its own
 * table (same column names), and adds its own {@code environment} collection table, so the two
 * scopes stay physically separate while sharing one definition.
 *
 * <p>Fields are public (Panache active-record style) and inherited, so existing code that reads
 * {@code action.name}/{@code action.executeScript} keeps working unchanged.
 */
@MappedSuperclass
public abstract class AbstractActionDefinition extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @Column(nullable = false)
  public String name;

  public String description;

  @Column(name = "execute_script", nullable = false, length = 4000)
  public String executeScript;

  @Column(name = "check_script", length = 4000)
  public String checkScript;

  /**
   * Whether this action runs as an interactive process in a workspace terminal (e.g. a shell or
   * Claude Code). One-off, non-interactive commands (e.g. {@code mvn test}) are false and are not
   * offered by the Run… terminal picker.
   */
  @Column(nullable = false)
  public boolean interactive = false;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  public Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  public Instant updatedAt;
}
