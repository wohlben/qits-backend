package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.*;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class ActionConfigurationServiceTest {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Test
  public void testCreateAndGet() {
    var config =
        actionConfigurationService.create(
            "Test Action", "A test action", "echo hello", "echo required", false, null, null);

    assertNotNull(config.id);
    assertEquals("Test Action", config.name);
    assertEquals("A test action", config.description);
    assertEquals("echo hello", config.executeScript);
    assertEquals("echo required", config.checkScript);
    assertFalse(config.interactive);
    assertEquals(ActionVariant.SHELL, config.variant);

    var found = actionConfigurationService.get(config.id);
    assertEquals(config.id, found.id);
  }

  @Test
  public void testCreateMissingNameThrows() {
    assertThrows(
        BadRequestException.class,
        () ->
            actionConfigurationService.create(
                null, null, "echo hello", "echo required", false, null, null));
  }

  @Test
  public void testCreateMissingExecuteScriptThrows() {
    assertThrows(
        BadRequestException.class,
        () ->
            actionConfigurationService.create(
                "Name", null, null, "echo required", false, null, null));
  }

  @Test
  public void testCreateWithoutCheckScriptSucceeds() {
    // checkScript is optional: a run-only action (e.g. "Bash") has no meaningful check.
    var config =
        actionConfigurationService.create("Run only", null, "exec bash", null, false, null, null);
    assertNotNull(config.id);
    assertNull(config.checkScript);
  }

  @Test
  public void testCreateInteractive() {
    var config =
        actionConfigurationService.create("Bash run", null, "exec bash", null, true, null, null);

    var found = actionConfigurationService.get(config.id);
    assertTrue(found.interactive);
  }

  @Test
  public void testCreateVariantDefaultsToShellAndCanBeSet() {
    var shell =
        actionConfigurationService.create("Plain", null, "exec bash", null, true, null, null);
    assertEquals(ActionVariant.SHELL, shell.variant);

    var claude =
        actionConfigurationService.create(
            "Claude+MCP", null, "exec claude", null, true, ActionVariant.CLAUDE_ACTIONS_MCP, null);
    assertEquals(
        ActionVariant.CLAUDE_ACTIONS_MCP, actionConfigurationService.get(claude.id).variant);
  }

  @Test
  public void testCreateWithEnvironment() {
    var config =
        actionConfigurationService.create(
            "With env",
            null,
            "exec claude",
            null,
            true,
            null,
            Map.of("EDITOR", "vim", "FOO", "bar"));

    var found = actionConfigurationService.get(config.id);
    assertEquals("vim", found.environment.get("EDITOR"));
    assertEquals("bar", found.environment.get("FOO"));
  }

  @Test
  public void testGetNotFoundThrows() {
    assertThrows(NotFoundException.class, () -> actionConfigurationService.get("non-existent"));
  }

  @Test
  public void testList() {
    long before = actionConfigurationRepository.count();
    actionConfigurationService.create("One", null, "echo 1", "echo required", false, null, null);
    actionConfigurationService.create("Two", null, "echo 2", "echo suggested", false, null, null);

    var list = actionConfigurationService.list();
    assertEquals(before + 2, list.size());
  }

  @Test
  public void testUpdate() {
    var config =
        actionConfigurationService.create(
            "Original", "Desc", "echo old", "echo optional", false, null, null);

    var updated =
        actionConfigurationService.update(
            config.id,
            "Updated",
            "New desc",
            "echo new",
            "echo required",
            true,
            ActionVariant.CLAUDE_ACTIONS_MCP,
            Map.of("K", "V"));

    assertEquals("Updated", updated.name);
    assertEquals("New desc", updated.description);
    assertEquals("echo new", updated.executeScript);
    assertEquals("echo required", updated.checkScript);
    assertTrue(updated.interactive);
    assertEquals(ActionVariant.CLAUDE_ACTIONS_MCP, updated.variant);
    assertEquals("V", updated.environment.get("K"));
  }

  @Test
  public void testUpdatePartial() {
    var config =
        actionConfigurationService.create(
            "Original", "Desc", "echo old", "echo optional", true, null, null);

    var updated =
        actionConfigurationService.update(
            config.id, null, "New desc", null, null, null, null, null);

    assertEquals("Original", updated.name);
    assertEquals("New desc", updated.description);
    assertEquals("echo old", updated.executeScript);
    assertEquals("echo optional", updated.checkScript);
    // interactive omitted (null) on a partial update keeps the existing value.
    assertTrue(updated.interactive);
  }

  @Test
  public void testUpdateCanClearCheckScript() {
    var config =
        actionConfigurationService.create(
            "Original", "Desc", "echo old", "echo optional", false, null, null);

    var updated =
        actionConfigurationService.update(config.id, null, null, null, "", null, null, null);

    assertNull(updated.checkScript);
  }

  @Test
  public void testUpdateNotFoundThrows() {
    assertThrows(
        NotFoundException.class,
        () ->
            actionConfigurationService.update(
                "non-existent", "Name", null, "echo", "echo", null, null, null));
  }

  @Test
  public void testDelete() {
    var config =
        actionConfigurationService.create(
            "ToDelete", null, "echo hello", "echo unnecessary", false, null, null);

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
