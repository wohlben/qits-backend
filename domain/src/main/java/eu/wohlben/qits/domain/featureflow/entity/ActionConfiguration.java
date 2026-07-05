package eu.wohlben.qits.domain.featureflow.entity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import java.util.HashMap;
import java.util.Map;

/**
 * A <strong>global</strong> action — available in every repository (e.g. a shell, Claude Code). The
 * shared definition (name, scripts, interactive flag, timestamps) is inherited from {@link
 * AbstractActionDefinition}; this class only adds the global env table and pins the table name, so
 * the existing schema and code paths are unchanged. Repository-owned actions are {@link
 * RepositoryAction}.
 */
@Entity
public class ActionConfiguration extends AbstractActionDefinition {

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
}
