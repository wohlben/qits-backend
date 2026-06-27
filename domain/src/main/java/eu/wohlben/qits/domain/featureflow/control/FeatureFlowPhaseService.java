package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowConfigurationRepository;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@ApplicationScoped
public class FeatureFlowPhaseService {

  @Inject FeatureFlowPhaseRepository featureFlowPhaseRepository;

  @Inject FeatureFlowConfigurationRepository featureFlowConfigurationRepository;

  @Transactional
  public FeatureFlowPhase create(
      String featureFlowConfigurationId,
      String name,
      String description,
      int orderIndex,
      String parentPhaseId) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }
    if (featureFlowConfigurationId == null || featureFlowConfigurationId.isBlank()) {
      throw new BadRequestException("featureFlowConfigurationId is required");
    }

    FeatureFlowConfiguration config =
        featureFlowConfigurationRepository
            .findByIdOptional(featureFlowConfigurationId)
            .orElseThrow(
                () ->
                    new NotFoundException(
                        "FeatureFlowConfiguration not found: " + featureFlowConfigurationId));

    FeatureFlowPhase phase = new FeatureFlowPhase();
    phase.name = name;
    phase.description = description;
    phase.orderIndex = orderIndex;
    phase.featureFlowConfiguration = config;

    if (parentPhaseId != null && !parentPhaseId.isBlank()) {
      FeatureFlowPhase parent =
          featureFlowPhaseRepository
              .findByIdOptional(parentPhaseId)
              .orElseThrow(
                  () ->
                      new NotFoundException("Parent FeatureFlowPhase not found: " + parentPhaseId));
      if (!parent.featureFlowConfiguration.id.equals(config.id)) {
        throw new BadRequestException(
            "Parent phase must belong to the same FeatureFlowConfiguration");
      }
      phase.parentPhase = parent;
    }

    featureFlowPhaseRepository.persist(phase);
    return phase;
  }

  public FeatureFlowPhase get(String id) {
    return featureFlowPhaseRepository
        .findByIdOptional(id)
        .orElseThrow(() -> new NotFoundException("FeatureFlowPhase not found: " + id));
  }

  public List<FeatureFlowPhase> listAll() {
    return featureFlowPhaseRepository.listAll();
  }

  public List<FeatureFlowPhase> listByFeatureFlowConfiguration(String featureFlowConfigurationId) {
    return featureFlowPhaseRepository.findByFeatureFlowConfigurationId(featureFlowConfigurationId);
  }

  @Transactional
  public FeatureFlowPhase update(
      String id, String name, String description, Integer orderIndex, String parentPhaseId) {
    FeatureFlowPhase phase =
        featureFlowPhaseRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhase not found: " + id));

    if (name != null && !name.isBlank()) {
      phase.name = name;
    }
    if (description != null) {
      phase.description = description;
    }
    if (orderIndex != null) {
      phase.orderIndex = orderIndex;
    }
    if (parentPhaseId != null) {
      if (parentPhaseId.isBlank()) {
        phase.parentPhase = null;
      } else {
        if (parentPhaseId.equals(id)) {
          throw new BadRequestException("A phase cannot be its own parent");
        }
        FeatureFlowPhase parent =
            featureFlowPhaseRepository
                .findByIdOptional(parentPhaseId)
                .orElseThrow(
                    () ->
                        new NotFoundException(
                            "Parent FeatureFlowPhase not found: " + parentPhaseId));
        if (!parent.featureFlowConfiguration.id.equals(phase.featureFlowConfiguration.id)) {
          throw new BadRequestException(
              "Parent phase must belong to the same FeatureFlowConfiguration");
        }
        if (wouldCreateCycle(phase, parent)) {
          throw new BadRequestException(
              "Setting this parent would create a cycle in the phase hierarchy");
        }
        phase.parentPhase = parent;
      }
    }

    return phase;
  }

  @Transactional
  public void delete(String id) {
    FeatureFlowPhase phase =
        featureFlowPhaseRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhase not found: " + id));
    featureFlowPhaseRepository.delete(phase);
  }

  private boolean wouldCreateCycle(FeatureFlowPhase child, FeatureFlowPhase proposedParent) {
    Set<String> visited = new HashSet<>();
    FeatureFlowPhase current = proposedParent;
    while (current != null) {
      if (current.id.equals(child.id)) {
        return true;
      }
      if (!visited.add(current.id)) {
        return true; // already visited = cycle in existing hierarchy
      }
      current = current.parentPhase;
    }
    return false;
  }
}
