package eu.wohlben.qits.domain.featureflow.entity;

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
import jakarta.persistence.MapKeyColumn;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * An action — a preconfigured process a workspace can run. Actions are <strong>global</strong>
 * (code-based, available in every repository, e.g. a shell); the repo-scoped DB config store was
 * removed in Part 5 (config-as-single-source-of-truth) — config-declared actions live only in the
 * workspace's committed {@code .qits-config.yml} and are never persisted.
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
