package eu.wohlben.qits.domain.daemon.persistence;

import eu.wohlben.qits.domain.daemon.entity.DaemonConfiguration;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;

@ApplicationScoped
public class DaemonConfigurationRepository
    implements PanacheRepositoryBase<DaemonConfiguration, String> {

  public Optional<DaemonConfiguration> findByName(String name) {
    return find("name", name).firstResultOptional();
  }
}
