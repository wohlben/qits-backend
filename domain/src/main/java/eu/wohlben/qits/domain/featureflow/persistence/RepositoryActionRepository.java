package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.RepositoryAction;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class RepositoryActionRepository implements PanacheRepositoryBase<RepositoryAction, String> {

  public List<RepositoryAction> findByRepositoryId(String repositoryId) {
    return list("repository.id", repositoryId);
  }

  public Optional<RepositoryAction> findByRepositoryAndName(String repositoryId, String name) {
    return find("repository.id = ?1 and name = ?2", repositoryId, name).firstResultOptional();
  }
}
