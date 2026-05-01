package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.persistence.FeatureFlowPhaseRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
public class FeatureFlowPhaseServiceTest {

    @Inject
    FeatureFlowPhaseService featureFlowPhaseService;

    @Inject
    FeatureFlowConfigurationService featureFlowConfigurationService;

    @Inject
    FeatureFlowPhaseRepository featureFlowPhaseRepository;

    @Test
    public void testCreateAndGet() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var phase = featureFlowPhaseService.create(config.id, "Refining", "Initial analysis", 0, null);

        assertNotNull(phase.id);
        assertEquals("Refining", phase.name);
        assertEquals("Initial analysis", phase.description);
        assertEquals(0, phase.orderIndex);
        assertEquals(config.id, phase.featureFlowConfiguration.id);
        assertNull(phase.parentPhase);

        var found = featureFlowPhaseService.get(phase.id);
        assertEquals(phase.id, found.id);
    }

    @Test
    public void testCreateWithParentPhase() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var parent = featureFlowPhaseService.create(config.id, "Development", null, 0, null);
        var child = featureFlowPhaseService.create(config.id, "Work Package A", null, 1, parent.id);

        assertEquals(parent.id, child.parentPhase.id);
    }

    @Test
    public void testCreateMissingNameThrows() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        assertThrows(BadRequestException.class, () ->
            featureFlowPhaseService.create(config.id, null, null, 0, null)
        );
    }

    @Test
    public void testCreateMissingConfigurationThrows() {
        assertThrows(BadRequestException.class, () ->
            featureFlowPhaseService.create(null, "Name", null, 0, null)
        );
    }

    @Test
    public void testCreateWithUnknownParentThrows() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        assertThrows(NotFoundException.class, () ->
            featureFlowPhaseService.create(config.id, "Name", null, 0, "non-existent")
        );
    }

    @Test
    public void testCreateWithParentFromDifferentConfigThrows() {
        FeatureFlowConfiguration configA = featureFlowConfigurationService.create("Flow A");
        FeatureFlowConfiguration configB = featureFlowConfigurationService.create("Flow B");
        var parent = featureFlowPhaseService.create(configA.id, "Parent", null, 0, null);

        assertThrows(BadRequestException.class, () ->
            featureFlowPhaseService.create(configB.id, "Child", null, 0, parent.id)
        );
    }

    @Test
    public void testGetNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            featureFlowPhaseService.get("non-existent")
        );
    }

    @Test
    public void testListByFeatureFlowConfiguration() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        featureFlowPhaseService.create(config.id, "Phase One", null, 0, null);
        featureFlowPhaseService.create(config.id, "Phase Two", null, 1, null);

        var list = featureFlowPhaseService.listByFeatureFlowConfiguration(config.id);
        assertEquals(2, list.size());
    }

    @Test
    public void testUpdate() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var phase = featureFlowPhaseService.create(config.id, "Original", "Desc", 0, null);

        var updated = featureFlowPhaseService.update(phase.id, "Updated", "New desc", 5, null);

        assertEquals("Updated", updated.name);
        assertEquals("New desc", updated.description);
        assertEquals(5, updated.orderIndex);
    }

    @Test
    public void testUpdateParentPhase() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var parent = featureFlowPhaseService.create(config.id, "Parent", null, 0, null);
        var phase = featureFlowPhaseService.create(config.id, "Orphan", null, 1, null);

        var updated = featureFlowPhaseService.update(phase.id, null, null, null, parent.id);
        assertEquals(parent.id, updated.parentPhase.id);
    }

    @Test
    public void testUpdateClearParentPhase() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var parent = featureFlowPhaseService.create(config.id, "Parent", null, 0, null);
        var phase = featureFlowPhaseService.create(config.id, "Child", null, 1, parent.id);

        var updated = featureFlowPhaseService.update(phase.id, null, null, null, "");
        assertNull(updated.parentPhase);
    }

    @Test
    public void testUpdateSelfParentThrows() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var phase = featureFlowPhaseService.create(config.id, "Phase", null, 0, null);

        assertThrows(BadRequestException.class, () ->
            featureFlowPhaseService.update(phase.id, null, null, null, phase.id)
        );
    }

    @Test
    public void testUpdateDeepCycleThrows() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var a = featureFlowPhaseService.create(config.id, "A", null, 0, null);
        var b = featureFlowPhaseService.create(config.id, "B", null, 1, a.id);
        var c = featureFlowPhaseService.create(config.id, "C", null, 2, b.id);

        // C -> B -> A; trying to make A's parent C would create A -> C -> B -> A
        assertThrows(BadRequestException.class, () ->
            featureFlowPhaseService.update(a.id, null, null, null, c.id)
        );
    }

    @Test
    public void testUpdateNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            featureFlowPhaseService.update("non-existent", "Name", null, 0, null)
        );
    }

    @Test
    public void testDelete() {
        FeatureFlowConfiguration config = featureFlowConfigurationService.create("Test Flow");
        var phase = featureFlowPhaseService.create(config.id, "ToDelete", null, 0, null);

        featureFlowPhaseService.delete(phase.id);

        assertTrue(featureFlowPhaseRepository.findByIdOptional(phase.id).isEmpty());
    }

    @Test
    public void testDeleteNotFoundThrows() {
        assertThrows(NotFoundException.class, () ->
            featureFlowPhaseService.delete("non-existent")
        );
    }
}
