package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class FeatureFlowPhaseRepository implements PanacheRepositoryBase<FeatureFlowPhase, String> {

  public List<FeatureFlowPhase> findByFeatureFlowConfigurationId(
      String featureFlowConfigurationId) {
    return list("featureFlowConfiguration.id", featureFlowConfigurationId);
  }
}
