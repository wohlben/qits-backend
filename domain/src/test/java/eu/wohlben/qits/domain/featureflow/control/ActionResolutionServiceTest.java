package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Verifies that actions resolve to their script verbatim (actions are plain shell scripts). */
@QuarkusTest
@TestProfile(ActionResolutionServiceTest.TestProfile.class)
public class ActionResolutionServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-action-resolution-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionResolutionService actionResolutionService;

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  private String createRepo(String projectName) throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create(projectName, null);
    return repositoryService.cloneRepository(fixtureUrl, null, project).id;
  }

  @Test
  public void globalActionResolvesToTheScriptVerbatim() {
    var action =
        actionConfigurationService.create("Shell test", null, "mvn test", null, false, null);

    var resolved = actionResolutionService.resolveForRepository("repo-xyz", action.id);

    assertEquals("mvn test", resolved.executeScript());
    assertEquals(ActionScope.GLOBAL, resolved.scope());
  }

  @Test
  public void repositoryActionResolvesOnlyInItsOwnRepository() throws Exception {
    String repoId = createRepo("Resolve Own Project");
    String otherRepoId = createRepo("Resolve Other Project");
    var action =
        actionConfigurationService.createForRepository(
            repoId, "repo-test", null, "./mvnw test", null, false, null);

    var resolved = actionResolutionService.resolveForRepository(repoId, action.id);
    assertEquals("./mvnw test", resolved.executeScript());
    assertEquals(ActionScope.REPOSITORY, resolved.scope());
    assertEquals(repoId, resolved.repositoryId());

    assertThrows(
        NotFoundException.class,
        () -> actionResolutionService.resolveForRepository(otherRepoId, action.id));
  }

  @Test
  public void effectiveActionsUnionsGlobalsWithOwnRepositoryActions() throws Exception {
    String repoId = createRepo("Union Project");
    String otherRepoId = createRepo("Union Other Project");
    var global =
        actionConfigurationService.create("union-global", null, "echo global", null, false, null);
    var own =
        actionConfigurationService.createForRepository(
            repoId, "union-own", null, "echo own", null, false, null);
    var foreign =
        actionConfigurationService.createForRepository(
            otherRepoId, "union-foreign", null, "echo foreign", null, false, null);

    var effective = actionResolutionService.effectiveActions(repoId);
    var ids = effective.stream().map(ActionConfigurationDto::id).toList();

    assertTrue(ids.contains(global.id));
    assertTrue(ids.contains(own.id));
    assertFalse(ids.contains(foreign.id));
    assertEquals(
        ActionScope.GLOBAL,
        effective.stream().filter(a -> a.id().equals(global.id)).findFirst().orElseThrow().scope());
    var ownDto = effective.stream().filter(a -> a.id().equals(own.id)).findFirst().orElseThrow();
    assertEquals(ActionScope.REPOSITORY, ownDto.scope());
    assertEquals(repoId, ownDto.repositoryId());
  }

  @Test
  public void resolvingAnUnknownActionThrows() {
    assertThrows(
        NotFoundException.class,
        () -> actionResolutionService.resolveForRepository("repo-xyz", "does-not-exist"));
  }

  @Test
  public void effectiveActionsForAnUnknownRepositoryThrows() {
    assertThrows(
        NotFoundException.class, () -> actionResolutionService.effectiveActions("does-not-exist"));
  }
}
