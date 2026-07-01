package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import eu.wohlben.qits.domain.error.NotFoundException;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** Verifies that actions resolve to their script verbatim (actions are plain shell scripts). */
@QuarkusTest
public class ActionResolutionServiceTest {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionResolutionService actionResolutionService;

  @Test
  public void globalActionResolvesToTheScriptVerbatim() {
    var action =
        actionConfigurationService.create("Shell test", null, "mvn test", null, false, null);

    var resolved = actionResolutionService.resolveForRepository("repo-xyz", action.id);

    assertEquals("mvn test", resolved.executeScript());
  }

  @Test
  public void resolvingAnUnknownActionThrows() {
    assertThrows(
        NotFoundException.class,
        () -> actionResolutionService.resolveForRepository("repo-xyz", "does-not-exist"));
  }
}
