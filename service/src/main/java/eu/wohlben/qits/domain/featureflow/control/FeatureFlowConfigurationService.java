package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowConfigurationRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.util.List;

@ApplicationScoped
public class FeatureFlowConfigurationService {

    @Inject
    FeatureFlowConfigurationRepository featureFlowConfigurationRepository;

    @Transactional
    public FeatureFlowConfiguration create(String name) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("name is required");
        }

        FeatureFlowConfiguration config = new FeatureFlowConfiguration();
        config.name = name;
        featureFlowConfigurationRepository.persist(config);

        return config;
    }

    public FeatureFlowConfiguration get(String id) {
        return featureFlowConfigurationRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowConfiguration not found: " + id));
    }

    public List<FeatureFlowConfiguration> list() {
        return featureFlowConfigurationRepository.listAll();
    }

    @Transactional
    public FeatureFlowConfiguration update(String id, String name) {
        FeatureFlowConfiguration config = featureFlowConfigurationRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowConfiguration not found: " + id));

        if (name != null && !name.isBlank()) {
            config.name = name;
        }

        return config;
    }

    @Transactional
    public void delete(String id) {
        FeatureFlowConfiguration config = featureFlowConfigurationRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowConfiguration not found: " + id));
        featureFlowConfigurationRepository.delete(config);
    }
}
