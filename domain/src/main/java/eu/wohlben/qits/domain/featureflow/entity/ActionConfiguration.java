package eu.wohlben.qits.domain.featureflow.entity;

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
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * An action — a preconfigured process a workspace can run. One table holds both scopes: {@code
 * repository == null} means <strong>global</strong> (available in every repository, e.g. a shell),
 * a set {@code repository} means <strong>repository-scoped</strong> (owned by that repository and
 * only available there, e.g. its build/test commands; cascade-deleted with it, see {@link
 * Repository#actions}). {@link ActionScope} is derived from that null-ness at mapping time, never
 * persisted. Because scope is a column rather than a table identity, {@link FeatureFlowPhaseAction}
 * can bind actions of either scope.
 */
@Entity
public class ActionConfiguration extends PanacheEntityBase {

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

  /** The owning repository, or {@code null} for a global action. */
  @ManyToOne
  @JoinColumn(name = "repository_id")
  public Repository repository;

  /**
   * Environment variables injected into the process when this action runs in a workspace terminal.
   * Overlaid over the server's inherited environment (action values win). Empty for actions that
   * only inherit the ambient env.
   */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "action_configuration_env",
      joinColumns = @JoinColumn(name = "action_configuration_id"))
  @MapKeyColumn(name = "env_key")
  @Column(name = "env_value", length = 2000)
  public Map<String, String> environment = new HashMap<>();

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  public Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at", nullable = false)
  public Instant updatedAt;
}
