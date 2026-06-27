package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseRepository;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseStepRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;

@ApplicationScoped
public class FeatureFlowPhaseStepService {

  @Inject FeatureFlowPhaseStepRepository featureFlowPhaseStepRepository;

  @Inject FeatureFlowPhaseRepository featureFlowPhaseRepository;

  @Transactional
  public FeatureFlowPhaseStep create(String phaseId, String name, int sortOrder) {
    if (phaseId == null || phaseId.isBlank()) {
      throw new BadRequestException("phaseId is required");
    }
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }

    FeatureFlowPhase phase =
        featureFlowPhaseRepository
            .findByIdOptional(phaseId)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhase not found: " + phaseId));

    FeatureFlowPhaseStep step = new FeatureFlowPhaseStep();
    step.phase = phase;
    step.name = name;
    step.sortOrder = sortOrder;

    featureFlowPhaseStepRepository.persist(step);
    return step;
  }

  public FeatureFlowPhaseStep get(String id) {
    return featureFlowPhaseStepRepository
        .findByIdOptional(id)
        .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseStep not found: " + id));
  }

  public List<FeatureFlowPhaseStep> listAll() {
    return featureFlowPhaseStepRepository.listAll();
  }

  public List<FeatureFlowPhaseStep> listByPhase(String phaseId) {
    return featureFlowPhaseStepRepository.findByPhaseId(phaseId);
  }

  @Transactional
  public FeatureFlowPhaseStep update(String id, String name, Integer sortOrder) {
    FeatureFlowPhaseStep step =
        featureFlowPhaseStepRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseStep not found: " + id));

    if (name != null && !name.isBlank()) {
      step.name = name;
    }
    if (sortOrder != null) {
      step.sortOrder = sortOrder;
    }

    return step;
  }

  @Transactional
  public void delete(String id) {
    FeatureFlowPhaseStep step =
        featureFlowPhaseStepRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseStep not found: " + id));
    featureFlowPhaseStepRepository.delete(step);
  }
}
