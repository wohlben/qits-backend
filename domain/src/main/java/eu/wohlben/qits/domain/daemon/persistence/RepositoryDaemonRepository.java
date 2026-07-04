package eu.wohlben.qits.domain.daemon.persistence;

import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class RepositoryDaemonRepository implements PanacheRepositoryBase<RepositoryDaemon, String> {

  public List<RepositoryDaemon> findByRepositoryId(String repositoryId) {
    return list("repository.id", repositoryId);
  }

  public Optional<RepositoryDaemon> findByRepositoryAndName(String repositoryId, String name) {
    return find("repository.id = ?1 and name = ?2", repositoryId, name).firstResultOptional();
  }
}
