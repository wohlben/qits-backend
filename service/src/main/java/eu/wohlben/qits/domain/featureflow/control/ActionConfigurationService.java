package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.util.List;

@ApplicationScoped
public class ActionConfigurationService {

    @Inject
    ActionConfigurationRepository actionConfigurationRepository;

    @Transactional
    public ActionConfiguration create(String id, String name, String description, String executeScript, String checkScript) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("name is required");
        }
        if (executeScript == null || executeScript.isBlank()) {
            throw new BadRequestException("executeScript is required");
        }
        if (checkScript == null || checkScript.isBlank()) {
            throw new BadRequestException("checkScript is required");
        }
        if (id == null || id.isBlank()) {
            throw new BadRequestException("id is required");
        }
        if (actionConfigurationRepository.findByIdOptional(id).isPresent()) {
            throw new BadRequestException("ActionConfiguration already exists: " + id);
        }

        ActionConfiguration config = new ActionConfiguration();
        config.id = id;
        config.name = name;
        config.description = description;
        config.executeScript = executeScript;
        config.checkScript = checkScript;
        actionConfigurationRepository.persist(config);

        return config;
    }

    public ActionConfiguration get(String id) {
        return actionConfigurationRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("ActionConfiguration not found: " + id));
    }

    public List<ActionConfiguration> list() {
        return actionConfigurationRepository.listAll();
    }

    @Transactional
    public ActionConfiguration update(String id, String name, String description, String executeScript, String checkScript) {
        ActionConfiguration config = actionConfigurationRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("ActionConfiguration not found: " + id));

        if (name != null && !name.isBlank()) {
            config.name = name;
        }
        if (description != null) {
            config.description = description;
        }
        if (executeScript != null && !executeScript.isBlank()) {
            config.executeScript = executeScript;
        }
        if (checkScript != null && !checkScript.isBlank()) {
            config.checkScript = checkScript;
        }

        return config;
    }

    @Transactional
    public void delete(String id) {
        ActionConfiguration config = actionConfigurationRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("ActionConfiguration not found: " + id));
        actionConfigurationRepository.delete(config);
    }
}
