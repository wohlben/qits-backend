package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseAction;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseActionRepository;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseStepRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.util.List;

@ApplicationScoped
public class FeatureFlowPhaseActionService {

    @Inject
    FeatureFlowPhaseActionRepository featureFlowPhaseActionRepository;

    @Inject
    FeatureFlowPhaseStepRepository featureFlowPhaseStepRepository;

    @Inject
    ActionConfigurationRepository actionConfigurationRepository;

    @Transactional
    public FeatureFlowPhaseAction create(String stepId, String actionConfigurationId, ActionType actionType, int sortOrder, String parallelGroup) {
        if (stepId == null || stepId.isBlank()) {
            throw new BadRequestException("stepId is required");
        }
        if (actionConfigurationId == null || actionConfigurationId.isBlank()) {
            throw new BadRequestException("actionConfigurationId is required");
        }
        if (actionType == null) {
            throw new BadRequestException("actionType is required");
        }

        FeatureFlowPhaseStep step = featureFlowPhaseStepRepository.findByIdOptional(stepId)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseStep not found: " + stepId));

        ActionConfiguration action = actionConfigurationRepository.findByIdOptional(actionConfigurationId)
            .orElseThrow(() -> new NotFoundException("ActionConfiguration not found: " + actionConfigurationId));

        boolean alreadyLinked = featureFlowPhaseActionRepository
            .find("step.id = ?1 and actionConfiguration.id = ?2", stepId, actionConfigurationId)
            .firstResultOptional()
            .isPresent();
        if (alreadyLinked) {
            throw new BadRequestException("ActionConfiguration is already linked to this step");
        }

        FeatureFlowPhaseAction link = new FeatureFlowPhaseAction();
        link.step = step;
        link.actionConfiguration = action;
        link.actionType = actionType;
        link.sortOrder = sortOrder;
        link.parallelGroup = parallelGroup;

        featureFlowPhaseActionRepository.persist(link);
        return link;
    }

    public FeatureFlowPhaseAction get(String id) {
        return featureFlowPhaseActionRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseAction not found: " + id));
    }

    public List<FeatureFlowPhaseAction> listAll() {
        return featureFlowPhaseActionRepository.listAll();
    }

    public List<FeatureFlowPhaseAction> listByStep(String stepId) {
        return featureFlowPhaseActionRepository.findByStepId(stepId);
    }

    @Transactional
    public FeatureFlowPhaseAction update(String id, ActionType actionType, Integer sortOrder, String parallelGroup) {
        FeatureFlowPhaseAction link = featureFlowPhaseActionRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseAction not found: " + id));

        if (actionType != null) {
            link.actionType = actionType;
        }
        if (sortOrder != null) {
            link.sortOrder = sortOrder;
        }
        if (parallelGroup != null) {
            link.parallelGroup = parallelGroup.isBlank() ? null : parallelGroup;
        }

        return link;
    }

    @Transactional
    public void delete(String id) {
        FeatureFlowPhaseAction link = featureFlowPhaseActionRepository.findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("FeatureFlowPhaseAction not found: " + id));
        featureFlowPhaseActionRepository.delete(link);
    }
}
