package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.*;

import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseActionRepository;
import eu.wohlben.qits.domain.project.control.ProjectService;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class FeatureFlowPhaseActionServiceTest {

  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject FeatureFlowPhaseActionRepository featureFlowPhaseActionRepository;

  @Inject ProjectService projectService;

  private FeatureFlowPhaseStep createStep() {
    var project = projectService.create("Action Project", null);
    FeatureFlowConfiguration config =
        featureFlowConfigurationService.createUnderProject(project.id, "Test Flow");
    FeatureFlowPhase phase = featureFlowPhaseService.create(config.id, "Phase", null, 0, null);
    return featureFlowPhaseStepService.create(phase.id, "Build", 0);
  }

  private ActionConfiguration createAction(String suffix) {
    return actionConfigurationService.create("Action " + suffix, "Desc", "echo exec", "echo check");
  }

  @Test
  public void testCreateAndGet() {
    var step = createStep();
    var action = createAction("act-1");

    var link =
        featureFlowPhaseActionService.create(
            step.id, action.id, ActionType.PREREQUISITE, 0, "group-a");

    assertNotNull(link.id);
    assertEquals(step.id, link.step.id);
    assertEquals(action.id, link.actionConfiguration.id);
    assertEquals(ActionType.PREREQUISITE, link.actionType);
    assertEquals(0, link.sortOrder);
    assertEquals("group-a", link.parallelGroup);

    var found = featureFlowPhaseActionService.get(link.id);
    assertEquals(link.id, found.id);
  }

  @Test
  public void testCreateQualityGate() {
    var step = createStep();
    var action = createAction("act-qg");

    var link =
        featureFlowPhaseActionService.create(step.id, action.id, ActionType.QUALITY_GATE, 1, null);

    assertEquals(ActionType.QUALITY_GATE, link.actionType);
    assertNull(link.parallelGroup);
  }

  @Test
  public void testCreateMissingStepThrows() {
    var action = createAction("act-2");
    assertThrows(
        BadRequestException.class,
        () ->
            featureFlowPhaseActionService.create(
                null, action.id, ActionType.PREREQUISITE, 0, null));
  }

  @Test
  public void testCreateMissingActionThrows() {
    var step = createStep();
    assertThrows(
        BadRequestException.class,
        () ->
            featureFlowPhaseActionService.create(step.id, null, ActionType.PREREQUISITE, 0, null));
  }

  @Test
  public void testCreateMissingActionTypeThrows() {
    var step = createStep();
    var action = createAction("act-3");
    assertThrows(
        BadRequestException.class,
        () -> featureFlowPhaseActionService.create(step.id, action.id, null, 0, null));
  }

  @Test
  public void testCreateUnknownStepThrows() {
    var action = createAction("act-4");
    assertThrows(
        NotFoundException.class,
        () ->
            featureFlowPhaseActionService.create(
                "non-existent", action.id, ActionType.PREREQUISITE, 0, null));
  }

  @Test
  public void testCreateUnknownActionThrows() {
    var step = createStep();
    assertThrows(
        NotFoundException.class,
        () ->
            featureFlowPhaseActionService.create(
                step.id, "non-existent", ActionType.PREREQUISITE, 0, null));
  }

  @Test
  public void testCreateDuplicateThrows() {
    var step = createStep();
    var action = createAction("act-dup");

    featureFlowPhaseActionService.create(step.id, action.id, ActionType.PREREQUISITE, 0, null);

    assertThrows(
        BadRequestException.class,
        () ->
            featureFlowPhaseActionService.create(
                step.id, action.id, ActionType.QUALITY_GATE, 1, null));
  }

  @Test
  public void testGetNotFoundThrows() {
    assertThrows(NotFoundException.class, () -> featureFlowPhaseActionService.get("non-existent"));
  }

  @Test
  public void testListByStep() {
    var step = createStep();
    var action1 = createAction("act-l1");
    var action2 = createAction("act-l2");

    featureFlowPhaseActionService.create(step.id, action1.id, ActionType.PREREQUISITE, 0, null);
    featureFlowPhaseActionService.create(step.id, action2.id, ActionType.QUALITY_GATE, 0, null);

    var list = featureFlowPhaseActionService.listByStep(step.id);
    assertEquals(2, list.size());
  }

  @Test
  public void testUpdate() {
    var step = createStep();
    var action = createAction("act-up");
    var link =
        featureFlowPhaseActionService.create(
            step.id, action.id, ActionType.PREREQUISITE, 0, "old-group");

    var updated =
        featureFlowPhaseActionService.update(link.id, ActionType.QUALITY_GATE, 5, "new-group");

    assertEquals(ActionType.QUALITY_GATE, updated.actionType);
    assertEquals(5, updated.sortOrder);
    assertEquals("new-group", updated.parallelGroup);
  }

  @Test
  public void testUpdateClearParallelGroup() {
    var step = createStep();
    var action = createAction("act-clr");
    var link =
        featureFlowPhaseActionService.create(
            step.id, action.id, ActionType.PREREQUISITE, 0, "group");

    var updated = featureFlowPhaseActionService.update(link.id, null, null, "");
    assertNull(updated.parallelGroup);
  }

  @Test
  public void testUpdateNotFoundThrows() {
    assertThrows(
        NotFoundException.class,
        () ->
            featureFlowPhaseActionService.update("non-existent", ActionType.QUALITY_GATE, 0, null));
  }

  @Test
  public void testDelete() {
    var step = createStep();
    var action = createAction("act-del");
    var link =
        featureFlowPhaseActionService.create(step.id, action.id, ActionType.PREREQUISITE, 0, null);

    featureFlowPhaseActionService.delete(link.id);

    assertTrue(featureFlowPhaseActionRepository.findByIdOptional(link.id).isEmpty());
  }

  @Test
  public void testDeleteNotFoundThrows() {
    assertThrows(
        NotFoundException.class, () -> featureFlowPhaseActionService.delete("non-existent"));
  }
}
