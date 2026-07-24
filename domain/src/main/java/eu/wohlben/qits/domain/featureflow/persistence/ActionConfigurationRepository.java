package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class ActionConfigurationRepository
    implements PanacheRepositoryBase<ActionConfiguration, String> {

  // Every row is global (code-based) — the repo-scoped store was dropped in Part 5.

  public Optional<ActionConfiguration> findGlobalByName(String name) {
    return find("name", name).firstResultOptional();
  }

  public List<ActionConfiguration> listGlobal() {
    return listAll();
  }

  public List<ActionConfiguration> listGlobalByName(String name) {
    return list("name", name);
  }
}
