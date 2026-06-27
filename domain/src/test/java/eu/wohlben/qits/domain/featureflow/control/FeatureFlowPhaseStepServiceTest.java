package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.*;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseStepRepository;
import eu.wohlben.qits.domain.project.control.ProjectService;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class FeatureFlowPhaseStepServiceTest {

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject FeatureFlowPhaseStepRepository featureFlowPhaseStepRepository;

  @Inject ProjectService projectService;

  private FeatureFlowPhase createPhase() {
    var project = projectService.create("Step Project", null);
    FeatureFlowConfiguration config =
        featureFlowConfigurationService.createUnderProject(project.id, "Test Flow");
    return featureFlowPhaseService.create(config.id, "Phase", null, 0, null);
  }

  @Test
  public void testCreateAndGet() {
    var phase = createPhase();
    var step = featureFlowPhaseStepService.create(phase.id, "Lint", 0);

    assertNotNull(step.id);
    assertEquals("Lint", step.name);
    assertEquals(0, step.sortOrder);
    assertEquals(phase.id, step.phase.id);

    var found = featureFlowPhaseStepService.get(step.id);
    assertEquals(step.id, found.id);
  }

  @Test
  public void testCreateMissingPhaseThrows() {
    assertThrows(
        BadRequestException.class, () -> featureFlowPhaseStepService.create(null, "Lint", 0));
  }

  @Test
  public void testCreateMissingNameThrows() {
    var phase = createPhase();
    assertThrows(
        BadRequestException.class, () -> featureFlowPhaseStepService.create(phase.id, null, 0));
  }

  @Test
  public void testCreateUnknownPhaseThrows() {
    assertThrows(
        NotFoundException.class,
        () -> featureFlowPhaseStepService.create("non-existent", "Lint", 0));
  }

  @Test
  public void testGetNotFoundThrows() {
    assertThrows(NotFoundException.class, () -> featureFlowPhaseStepService.get("non-existent"));
  }

  @Test
  public void testListByPhase() {
    var phase = createPhase();
    featureFlowPhaseStepService.create(phase.id, "Build", 0);
    featureFlowPhaseStepService.create(phase.id, "Test", 1);

    var list = featureFlowPhaseStepService.listByPhase(phase.id);
    assertEquals(2, list.size());
  }

  @Test
  public void testUpdate() {
    var phase = createPhase();
    var step = featureFlowPhaseStepService.create(phase.id, "Build", 0);

    var updated = featureFlowPhaseStepService.update(step.id, "Lint", 5);

    assertEquals("Lint", updated.name);
    assertEquals(5, updated.sortOrder);
  }

  @Test
  public void testUpdatePartial() {
    var phase = createPhase();
    var step = featureFlowPhaseStepService.create(phase.id, "Build", 0);

    var updated = featureFlowPhaseStepService.update(step.id, null, null);

    assertEquals("Build", updated.name);
    assertEquals(0, updated.sortOrder);
  }

  @Test
  public void testUpdateNotFoundThrows() {
    assertThrows(
        NotFoundException.class,
        () -> featureFlowPhaseStepService.update("non-existent", "Name", 0));
  }

  @Test
  public void testDelete() {
    var phase = createPhase();
    var step = featureFlowPhaseStepService.create(phase.id, "ToDelete", 0);

    featureFlowPhaseStepService.delete(step.id);

    assertTrue(featureFlowPhaseStepRepository.findByIdOptional(step.id).isEmpty());
  }

  @Test
  public void testDeleteNotFoundThrows() {
    assertThrows(NotFoundException.class, () -> featureFlowPhaseStepService.delete("non-existent"));
  }
}
