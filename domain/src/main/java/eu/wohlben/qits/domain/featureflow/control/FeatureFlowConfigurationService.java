package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowConfigurationRepository;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;

@ApplicationScoped
public class FeatureFlowConfigurationService {

  @Inject FeatureFlowConfigurationRepository featureFlowConfigurationRepository;

  @Inject ProjectRepository projectRepository;

  @Transactional
  public FeatureFlowConfiguration createUnderProject(String projectId, String name) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }

    Project project =
        projectRepository
            .findByIdOptional(projectId)
            .orElseThrow(() -> new NotFoundException("Project not found: " + projectId));

    FeatureFlowConfiguration config = new FeatureFlowConfiguration();
    config.name = name;
    config.project = project;
    featureFlowConfigurationRepository.persist(config);

    return config;
  }

  public List<FeatureFlowConfiguration> listByProject(String projectId) {
    return featureFlowConfigurationRepository.list("project.id", projectId);
  }

  public FeatureFlowConfiguration get(String id) {
    return featureFlowConfigurationRepository
        .findByIdOptional(id)
        .orElseThrow(() -> new NotFoundException("FeatureFlowConfiguration not found: " + id));
  }

  public List<FeatureFlowConfiguration> list() {
    return featureFlowConfigurationRepository.listAll();
  }

  @Transactional
  public FeatureFlowConfiguration update(String id, String name) {
    FeatureFlowConfiguration config =
        featureFlowConfigurationRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowConfiguration not found: " + id));

    if (name != null && !name.isBlank()) {
      config.name = name;
    }

    return config;
  }

  @Transactional
  public void delete(String id) {
    FeatureFlowConfiguration config =
        featureFlowConfigurationRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowConfiguration not found: " + id));
    featureFlowConfigurationRepository.delete(config);
  }
}
