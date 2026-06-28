package eu.wohlben.qits.domain.featureflow.entity;

import eu.wohlben.qits.domain.repository.entity.Repository;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.Table;
import java.util.HashMap;
import java.util.Map;

/**
 * A <strong>repository-scoped</strong> action — owned by one {@link Repository} and only available
 * there (e.g. that repo's test-suite command). Shares its definition with the global {@link
 * ActionConfiguration} via {@link AbstractActionDefinition} but lives in its own table, cascade-
 * deleted with its repository (see {@link Repository#actions}).
 */
@Entity
@Table(name = "repository_action")
public class RepositoryAction extends AbstractActionDefinition {

  @ManyToOne(optional = false)
  @JoinColumn(name = "repository_id", nullable = false)
  public Repository repository;

  /** Per-action environment, overlaid on the inherited process env when the action runs. */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_action_env",
      joinColumns = @JoinColumn(name = "repository_action_id"))
  @MapKeyColumn(name = "env_key")
  @Column(name = "env_value", length = 2000)
  public Map<String, String> environment = new HashMap<>();
}
