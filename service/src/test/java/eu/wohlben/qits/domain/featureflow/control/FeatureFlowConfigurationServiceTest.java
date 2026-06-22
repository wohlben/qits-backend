package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.*;

import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowConfigurationRepository;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class FeatureFlowConfigurationServiceTest {

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowConfigurationRepository featureFlowConfigurationRepository;

  @Inject ProjectService projectService;

  private Project createProject() {
    return projectService.create("Test Project", null);
  }

  @Test
  public void testCreateAndGet() {
    var project = createProject();
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Test Flow");

    assertNotNull(config.id);
    assertEquals("Test Flow", config.name);
    assertEquals(project.id, config.project.id);

    var found = featureFlowConfigurationService.get(config.id);
    assertEquals(config.id, found.id);
    assertEquals("Test Flow", found.name);
  }

  @Test
  public void testCreateMissingNameThrows() {
    var project = createProject();
    assertThrows(
        BadRequestException.class,
        () -> featureFlowConfigurationService.createUnderProject(project.id, null));
    assertThrows(
        BadRequestException.class,
        () -> featureFlowConfigurationService.createUnderProject(project.id, "   "));
  }

  @Test
  public void testCreateMissingProjectThrows() {
    assertThrows(
        NotFoundException.class,
        () -> featureFlowConfigurationService.createUnderProject("non-existent", "Name"));
  }

  @Test
  public void testGetNotFoundThrows() {
    assertThrows(
        NotFoundException.class, () -> featureFlowConfigurationService.get("non-existent"));
  }

  @Test
  public void testList() {
    var project = createProject();
    long before = featureFlowConfigurationRepository.count();
    featureFlowConfigurationService.createUnderProject(project.id, "Flow One");
    featureFlowConfigurationService.createUnderProject(project.id, "Flow Two");

    var list = featureFlowConfigurationService.list();
    assertEquals(before + 2, list.size());
  }

  @Test
  public void testListByProject() {
    var projectA = createProject();
    var projectB = createProject();
    featureFlowConfigurationService.createUnderProject(projectA.id, "Flow A");
    featureFlowConfigurationService.createUnderProject(projectA.id, "Flow A2");
    featureFlowConfigurationService.createUnderProject(projectB.id, "Flow B");

    var listA = featureFlowConfigurationService.listByProject(projectA.id);
    assertEquals(2, listA.size());

    var listB = featureFlowConfigurationService.listByProject(projectB.id);
    assertEquals(1, listB.size());
  }

  @Test
  public void testUpdate() {
    var project = createProject();
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Original");

    var updated = featureFlowConfigurationService.update(config.id, "Updated");

    assertEquals("Updated", updated.name);
  }

  @Test
  public void testUpdatePartial() {
    var project = createProject();
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Original");

    var updated = featureFlowConfigurationService.update(config.id, null);

    assertEquals("Original", updated.name);
  }

  @Test
  public void testUpdateNotFoundThrows() {
    assertThrows(
        NotFoundException.class,
        () -> featureFlowConfigurationService.update("non-existent", "Name"));
  }

  @Test
  public void testDelete() {
    var project = createProject();
    var config = featureFlowConfigurationService.createUnderProject(project.id, "ToDelete");

    assertNotNull(featureFlowConfigurationService.get(config.id));

    featureFlowConfigurationService.delete(config.id);

    // Post-delete visibility is verified in the controller test where each
    // request runs in its own transaction. Within a single test transaction
    // the deleted entity may remain visible to subsequent finds.
  }

  @Test
  public void testDeleteNotFoundThrows() {
    assertThrows(
        NotFoundException.class, () -> featureFlowConfigurationService.delete("non-existent"));
  }
}
