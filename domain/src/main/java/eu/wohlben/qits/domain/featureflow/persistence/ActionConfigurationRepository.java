package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class ActionConfigurationRepository
    implements PanacheRepositoryBase<ActionConfiguration, String> {

  // Global rows are matched with "repository is null" (not "repository.id is null", which would
  // join through the association and silently drop them).

  public Optional<ActionConfiguration> findGlobalByName(String name) {
    return find("name = ?1 and repository is null", name).firstResultOptional();
  }

  public List<ActionConfiguration> listGlobal() {
    return list("repository is null");
  }

  public List<ActionConfiguration> listGlobalByName(String name) {
    return list("name = ?1 and repository is null", name);
  }

  public List<ActionConfiguration> listByRepositoryId(String repositoryId) {
    return list("repository.id", repositoryId);
  }

  /** Every action available in a repository: the globals plus the repository's own. */
  public List<ActionConfiguration> listEffective(String repositoryId) {
    return list("repository is null or repository.id = ?1", repositoryId);
  }
}
