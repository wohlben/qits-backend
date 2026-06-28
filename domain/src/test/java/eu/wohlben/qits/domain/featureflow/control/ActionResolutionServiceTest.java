package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** Verifies that action variants are rendered into the right command by the resolver. */
@QuarkusTest
public class ActionResolutionServiceTest {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionResolutionService actionResolutionService;

  @Test
  public void shellVariantResolvesToTheScriptVerbatim() {
    var action =
        actionConfigurationService.create(
            "Shell test", null, "mvn test", null, false, ActionVariant.SHELL, null);

    var resolved = actionResolutionService.resolveForRepository("repo-xyz", action.id);

    assertEquals("mvn test", resolved.executeScript());
  }

  @Test
  public void claudeActionsMcpVariantRendersRepoScopedMcpFlags() {
    var action =
        actionConfigurationService.create(
            "Claude MCP", null, "exec claude", null, true, ActionVariant.CLAUDE_ACTIONS_MCP, null);

    String repoId = "11111111-1111-1111-1111-111111111111";
    var resolved = actionResolutionService.resolveForRepository(repoId, action.id);
    String cmd = resolved.executeScript();

    assertTrue(cmd.startsWith("exec claude "), cmd);
    assertTrue(cmd.contains("--strict-mcp-config"), cmd);
    assertTrue(cmd.contains("--mcp-config"), cmd);
    assertTrue(cmd.contains("/mcp/actions?repositoryId=" + repoId), cmd);
    // The flags are built by the backend — the action's stored script doesn't contain them.
    assertEquals("exec claude", action.executeScript);
  }

  @Test
  public void claudeActionsMcpRejectsANonUuidRepositoryId() {
    var action =
        actionConfigurationService.create(
            "Claude MCP guard",
            null,
            "exec claude",
            null,
            true,
            ActionVariant.CLAUDE_ACTIONS_MCP,
            null);

    // A repo id that isn't a UUID must be rejected before it can be embedded in the shell command.
    assertThrows(
        BadRequestException.class,
        () -> actionResolutionService.resolveForRepository("bad'; touch pwned; '", action.id));
  }
}
