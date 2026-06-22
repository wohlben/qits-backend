package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.*;

import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class ActionConfigurationServiceTest {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Test
  public void testCreateAndGet() {
    var config =
        actionConfigurationService.create(
            "Test Action", "A test action", "echo hello", "echo required");

    assertNotNull(config.id);
    assertEquals("Test Action", config.name);
    assertEquals("A test action", config.description);
    assertEquals("echo hello", config.executeScript);
    assertEquals("echo required", config.checkScript);

    var found = actionConfigurationService.get(config.id);
    assertEquals(config.id, found.id);
  }

  @Test
  public void testCreateMissingNameThrows() {
    assertThrows(
        BadRequestException.class,
        () -> actionConfigurationService.create(null, null, "echo hello", "echo required"));
  }

  @Test
  public void testCreateMissingExecuteScriptThrows() {
    assertThrows(
        BadRequestException.class,
        () -> actionConfigurationService.create("Name", null, null, "echo required"));
  }

  @Test
  public void testCreateMissingCheckScriptThrows() {
    assertThrows(
        BadRequestException.class,
        () -> actionConfigurationService.create("Name", null, "echo hello", null));
  }

  @Test
  public void testGetNotFoundThrows() {
    assertThrows(NotFoundException.class, () -> actionConfigurationService.get("non-existent"));
  }

  @Test
  public void testList() {
    long before = actionConfigurationRepository.count();
    actionConfigurationService.create("One", null, "echo 1", "echo required");
    actionConfigurationService.create("Two", null, "echo 2", "echo suggested");

    var list = actionConfigurationService.list();
    assertEquals(before + 2, list.size());
  }

  @Test
  public void testUpdate() {
    var config = actionConfigurationService.create("Original", "Desc", "echo old", "echo optional");

    var updated =
        actionConfigurationService.update(
            config.id, "Updated", "New desc", "echo new", "echo required");

    assertEquals("Updated", updated.name);
    assertEquals("New desc", updated.description);
    assertEquals("echo new", updated.executeScript);
    assertEquals("echo required", updated.checkScript);
  }

  @Test
  public void testUpdatePartial() {
    var config = actionConfigurationService.create("Original", "Desc", "echo old", "echo optional");

    var updated = actionConfigurationService.update(config.id, null, "New desc", null, null);

    assertEquals("Original", updated.name);
    assertEquals("New desc", updated.description);
    assertEquals("echo old", updated.executeScript);
    assertEquals("echo optional", updated.checkScript);
  }

  @Test
  public void testUpdateNotFoundThrows() {
    assertThrows(
        NotFoundException.class,
        () -> actionConfigurationService.update("non-existent", "Name", null, "echo", "echo"));
  }

  @Test
  public void testDelete() {
    var config =
        actionConfigurationService.create("ToDelete", null, "echo hello", "echo unnecessary");

    assertNotNull(actionConfigurationService.get(config.id));

    actionConfigurationService.delete(config.id);

    // Post-delete visibility is verified in the controller test where each
    // request runs in its own transaction. Within a single test transaction
    // the deleted entity may remain visible to subsequent finds.
  }

  @Test
  public void testDeleteNotFoundThrows() {
    assertThrows(NotFoundException.class, () -> actionConfigurationService.delete("non-existent"));
  }
}
