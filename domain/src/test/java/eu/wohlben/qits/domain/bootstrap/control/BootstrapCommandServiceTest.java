package eu.wohlben.qits.domain.bootstrap.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.bootstrap.entity.BootstrapCommand;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import eu.wohlben.qits.domain.repository.entity.Repository;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * CRUD + ordering semantics of the repository-owned bootstrap chain: creation appends (orderIndex =
 * max+1), the list always comes back in execution order, {@code reorder} atomically re-stamps the
 * whole sequence (and validates set equality), ownership is enforced, and the {@code
 * '@qits-config'} name namespace stays reserved for ingestion.
 */
@QuarkusTest
@TestProfile(BootstrapCommandServiceTest.TestProfile.class)
public class BootstrapCommandServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        return Map.of(
            "qits.repositories.data-dir",
            Files.createTempDirectory("qits-bootstrap-svc-test").toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;
  @Inject RepositoryService repositoryService;
  @Inject BootstrapCommandService service;

  private String repo(String name) throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create(name, null);
    Repository repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    return repo.id;
  }

  @Test
  public void createAppendsAndListReturnsExecutionOrder() throws Exception {
    String repoId = repo("Bootstrap Order");
    String first = service.create(repoId, "install", null, "./mvnw install", null, null, null).id;
    String second = service.create(repoId, "seed", null, "./seed", null, null, null).id;

    List<BootstrapCommand> chain = service.list(repoId);
    assertEquals(List.of(first, second), chain.stream().map(c -> c.id).toList());
    assertEquals(0, chain.get(0).orderIndex);
    assertEquals(1, chain.get(1).orderIndex, "creation without an index appends (max+1)");
  }

  @Test
  public void updateIsPartialAndBlankCheckClears() throws Exception {
    String repoId = repo("Bootstrap Update");
    String id =
        service.create(repoId, "step", "desc", "./go", "test -f marker", Map.of("A", "1"), null).id;

    service.update(repoId, id, null, null, null, "", null, null);

    BootstrapCommand updated = service.get(repoId, id);
    assertEquals("step", updated.name, "omitted fields keep their value");
    assertEquals("./go", updated.executeScript);
    assertEquals("1", updated.environment.get("A"));
    assertNull(updated.checkScript, "a blank checkScript clears the guard");
  }

  @Test
  public void reorderRestampsAtomicallyAndValidatesTheIdSet() throws Exception {
    String repoId = repo("Bootstrap Reorder");
    String a = service.create(repoId, "a", null, "./a", null, null, null).id;
    String b = service.create(repoId, "b", null, "./b", null, null, null).id;
    String c = service.create(repoId, "c", null, "./c", null, null, null).id;

    service.reorder(repoId, List.of(c, a, b));
    assertEquals(List.of(c, a, b), service.list(repoId).stream().map(cmd -> cmd.id).toList());

    // Partial and superset id lists are rejected — a half-applied order would corrupt the chain.
    assertThrows(BadRequestException.class, () -> service.reorder(repoId, List.of(a, b)));
    assertThrows(
        BadRequestException.class, () -> service.reorder(repoId, List.of(a, b, c, "ghost")));
  }

  @Test
  public void ownershipIsEnforced() throws Exception {
    String repoA = repo("Bootstrap Owner A");
    String repoB = repo("Bootstrap Owner B");
    String id = service.create(repoA, "step", null, "./go", null, null, null).id;

    assertThrows(NotFoundException.class, () -> service.get(repoB, id));
    assertThrows(NotFoundException.class, () -> service.delete(repoB, id));
    assertEquals("step", service.get(repoA, id).name);
  }

  @Test
  public void reservedSuffixAndBlankScriptsAreRejected() throws Exception {
    String repoId = repo("Bootstrap Guard");
    assertThrows(
        BadRequestException.class,
        () ->
            service.create(
                repoId, "x" + QitsConfig.CONFIG_NAME_SUFFIX, null, "./go", null, null, null));
    assertThrows(
        BadRequestException.class,
        () -> service.create(repoId, "no-script", null, "  ", null, null, null));
    assertTrue(service.list(repoId).isEmpty());
  }
}
