package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class FeatureFlowPhaseStepRepository implements PanacheRepositoryBase<FeatureFlowPhaseStep, String> {

    public List<FeatureFlowPhaseStep> findByPhaseId(String phaseId) {
        return list("phase.id", phaseId);
    }
}
