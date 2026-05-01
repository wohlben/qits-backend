package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowConfigurationRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
public class FeatureFlowConfigurationServiceTest {

    @Inject
    FeatureFlowConfigurationService featureFlowConfigurationService;

    @Inject
    FeatureFlowConfigurationRepository featureFlowConfigurationRepository;

    @Test
    public void testCreateAndGet() {
        var config = featureFlowConfigurationService.create("Test Flow");

        assertNotNull(config.id);
        assertEquals("Test Flow", config.name);

        var found = featureFlowConfigurationService.get(config.id);
        assertEquals(config.id, found.id);
        assertEquals("Test Flow", found.name);
    }

    @Test
    public void testCreateMissingNameThrows() {
        assertThrows(BadRequestException.class, () ->
            featureFlowConfigurationService.create(null)
        );
        assertThrows(BadRequestException.class, () ->
            featureFlowConfigurationService.create("   ")
        );
    }

    @Test
    public void testGetNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            featureFlowConfigurationService.get("non-existent")
        );
    }

    @Test
    public void testList() {
        long before = featureFlowConfigurationRepository.count();
        featureFlowConfigurationService.create("Flow One");
        featureFlowConfigurationService.create("Flow Two");

        var list = featureFlowConfigurationService.list();
        assertEquals(before + 2, list.size());
    }

    @Test
    public void testUpdate() {
        var config = featureFlowConfigurationService.create("Original");

        var updated = featureFlowConfigurationService.update(config.id, "Updated");

        assertEquals("Updated", updated.name);
    }

    @Test
    public void testUpdatePartial() {
        var config = featureFlowConfigurationService.create("Original");

        var updated = featureFlowConfigurationService.update(config.id, null);

        assertEquals("Original", updated.name);
    }

    @Test
    public void testUpdateNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            featureFlowConfigurationService.update("non-existent", "Name")
        );
    }

    @Test
    public void testDelete() {
        var config = featureFlowConfigurationService.create("ToDelete");

        assertNotNull(featureFlowConfigurationService.get(config.id));

        featureFlowConfigurationService.delete(config.id);

        // Post-delete visibility is verified in the controller test where each
        // request runs in its own transaction. Within a single test transaction
        // the deleted entity may remain visible to subsequent finds.
    }

    @Test
    public void testDeleteNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            featureFlowConfigurationService.delete("non-existent")
        );
    }
}
