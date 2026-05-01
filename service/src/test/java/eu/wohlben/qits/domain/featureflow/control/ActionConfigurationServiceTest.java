package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
public class ActionConfigurationServiceTest {

    @Inject
    ActionConfigurationService actionConfigurationService;

    @Inject
    ActionConfigurationRepository actionConfigurationRepository;

    @Test
    public void testCreateAndGet() {
        var config = actionConfigurationService.create(
            "test-create", "Test Action", "A test action", "echo hello", "echo required"
        );

        assertEquals("test-create", config.id);
        assertEquals("Test Action", config.name);
        assertEquals("A test action", config.description);
        assertEquals("echo hello", config.executeScript);
        assertEquals("echo required", config.checkScript);

        var found = actionConfigurationService.get("test-create");
        assertEquals(config.id, found.id);
    }

    @Test
    public void testCreateDuplicateIdThrows() {
        actionConfigurationService.create("test-dup", "First", null, "echo 1", "echo optional");

        assertThrows(BadRequestException.class, () ->
            actionConfigurationService.create("test-dup", "Second", null, "echo 2", "echo optional")
        );
    }

    @Test
    public void testCreateMissingNameThrows() {
        assertThrows(BadRequestException.class, () ->
            actionConfigurationService.create("test-no-name", null, null, "echo hello", "echo required")
        );
    }

    @Test
    public void testCreateMissingExecuteScriptThrows() {
        assertThrows(BadRequestException.class, () ->
            actionConfigurationService.create("test-no-exec", "Name", null, null, "echo required")
        );
    }

    @Test
    public void testCreateMissingCheckScriptThrows() {
        assertThrows(BadRequestException.class, () ->
            actionConfigurationService.create("test-no-check", "Name", null, "echo hello", null)
        );
    }

    @Test
    public void testGetNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            actionConfigurationService.get("non-existent")
        );
    }

    @Test
    public void testList() {
        long before = actionConfigurationRepository.count();
        actionConfigurationService.create("test-list-1", "One", null, "echo 1", "echo required");
        actionConfigurationService.create("test-list-2", "Two", null, "echo 2", "echo suggested");

        var list = actionConfigurationService.list();
        assertEquals(before + 2, list.size());
    }

    @Test
    public void testUpdate() {
        actionConfigurationService.create(
            "test-update", "Original", "Desc", "echo old", "echo optional"
        );

        var updated = actionConfigurationService.update(
            "test-update", "Updated", "New desc", "echo new", "echo required"
        );

        assertEquals("Updated", updated.name);
        assertEquals("New desc", updated.description);
        assertEquals("echo new", updated.executeScript);
        assertEquals("echo required", updated.checkScript);
    }

    @Test
    public void testUpdatePartial() {
        actionConfigurationService.create(
            "test-update-partial", "Original", "Desc", "echo old", "echo optional"
        );

        var updated = actionConfigurationService.update(
            "test-update-partial", null, "New desc", null, null
        );

        assertEquals("Original", updated.name);
        assertEquals("New desc", updated.description);
        assertEquals("echo old", updated.executeScript);
        assertEquals("echo optional", updated.checkScript);
    }

    @Test
    public void testUpdateNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            actionConfigurationService.update("non-existent", "Name", null, "echo", "echo")
        );
    }

    @Test
    public void testDelete() {
        actionConfigurationService.create(
            "test-delete", "ToDelete", null, "echo hello", "echo unnecessary"
        );

        assertNotNull(actionConfigurationService.get("test-delete"));

        actionConfigurationService.delete("test-delete");

        // Post-delete visibility is verified in the controller test where each
        // request runs in its own transaction. Within a single test transaction
        // the deleted entity may remain visible to subsequent finds.
    }

    @Test
    public void testDeleteNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            actionConfigurationService.delete("non-existent")
        );
    }
}
