package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseAction;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class FeatureFlowPhaseActionRepository
    implements PanacheRepositoryBase<FeatureFlowPhaseAction, String> {

  public List<FeatureFlowPhaseAction> findByStepId(String stepId) {
    return list("step.id", stepId);
  }

  public List<FeatureFlowPhaseAction> findByPhaseId(String phaseId) {
    return list("step.phase.id", phaseId);
  }

  /** Whether any flow step binds this global action configuration. */
  public boolean existsByActionConfigurationId(String actionConfigurationId) {
    return count("actionConfiguration.id", actionConfigurationId) > 0;
  }
}
