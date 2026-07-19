package eu.wohlben.qits.domain.bootstrap.persistence;

import eu.wohlben.qits.domain.bootstrap.entity.BootstrapCommand;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class BootstrapCommandRepository implements PanacheRepositoryBase<BootstrapCommand, String> {

  /** The repository's chain in execution order (createdAt breaks orderIndex ties). */
  public List<BootstrapCommand> findByRepositoryIdOrdered(String repositoryId) {
    return list("repository.id = ?1 order by orderIndex, createdAt", repositoryId);
  }
}
