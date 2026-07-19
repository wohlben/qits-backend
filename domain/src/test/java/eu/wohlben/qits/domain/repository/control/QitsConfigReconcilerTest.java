package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.bootstrap.control.BootstrapCommandService;
import eu.wohlben.qits.domain.bootstrap.entity.BootstrapCommand;
import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.RepositoryArchetype;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Host-side coverage of {@code .qits-config.yml} ingestion on clone/sync/reload: a source repo is
 * built on disk with a committed config, cloned, and its declared actions/daemons reconciled into
 * the existing tables — all container-free (the file is read straight from the bare origin).
 */
@QuarkusTest
@TestProfile(QitsConfigReconcilerTest.TestProfile.class)
public class QitsConfigReconcilerTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        return Map.of(
            "qits.repositories.data-dir", Files.createTempDirectory("qits-config-test").toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject RepositoryService repositoryService;
  @Inject ProjectService projectService;
  @Inject RepositoryRepository repositoryRepository;
  @Inject ActionConfigurationService actionConfigurationService;
  @Inject RepositoryDaemonService repositoryDaemonService;
  @Inject BootstrapCommandService bootstrapCommandService;
  @Inject QitsConfigReconciler reconciler;
  @Inject GitExecutor git;
  @Inject jakarta.persistence.EntityManager entityManager;

  /**
   * The repository read fresh from the DB. Ingestion commits in its own transaction; the test's
   * request-scoped persistence context would otherwise return a stale first-level-cached row (in
   * production every read is a fresh request, so this mirrors it).
   */
  private Repository freshRepo(String repoId) {
    entityManager.clear();
    return repositoryService.get(repoId);
  }

  private static final String CONFIG =
      """
      version: 1
      repository:
        archetype: SERVICE_TEMPLATE
      actions:
        - name: build-project
          description: Full build
          execute: ./mvnw package
        - name: run-tests
          execute: ./mvnw test
      daemons:
        - name: dev-server
          start: ./mvnw quarkus:dev
          ready-pattern: "Listening on"
          otel: true
          web-view:
            port: 4200
          observers:
            - kind: LOG_LEVEL
          sources:
            - path: quarkus.log
      """;

  /**
   * Builds a non-bare source repo on {@code main} with the given file contents, returns its path.
   */
  private String source(String configYaml) throws Exception {
    Path dir = Files.createTempDirectory("qits-config-src");
    git.exec(dir.toFile(), "git", "init", "-b", "main");
    git.exec(dir.toFile(), "git", "config", "user.email", "t@example.com");
    git.exec(dir.toFile(), "git", "config", "user.name", "Test");
    Files.writeString(dir.resolve("README.md"), "hi\n");
    if (configYaml != null) {
      Files.writeString(dir.resolve(".qits-config.yml"), configYaml);
    }
    git.exec(dir.toFile(), "git", "add", "-A");
    git.exec(dir.toFile(), "git", "commit", "-m", "init");
    return dir.toString();
  }

  private void commit(String sourcePath, String configYaml) throws Exception {
    Path dir = Path.of(sourcePath);
    Files.writeString(dir.resolve(".qits-config.yml"), configYaml);
    git.exec(dir.toFile(), "git", "add", "-A");
    git.exec(dir.toFile(), "git", "commit", "-m", "update config");
  }

  private List<ActionConfiguration> repoActions(String repoId) {
    return actionConfigurationService.listForRepository(repoId);
  }

  private List<RepositoryDaemon> repoDaemons(String repoId) {
    return repositoryDaemonService.list(repoId);
  }

  private List<BootstrapCommand> repoBootstrap(String repoId) {
    // Clear the request-scoped first-level cache: re-ingest re-stamps orderIndex in its own
    // committed transaction, and a stale cached entity would otherwise shadow the new value (the
    // same gotcha freshRepo documents).
    entityManager.clear();
    return bootstrapCommandService.list(repoId);
  }

  @Test
  public void cloneIngestsDeclaredActionsAndDaemons() throws Exception {
    var project = projectService.create("Cfg Clone", null);
    Repository repo = repositoryService.cloneRepository(source(CONFIG), null, project);

    List<ActionConfiguration> actions = repoActions(repo.id);
    assertEquals(2, actions.size());
    assertTrue(actions.stream().allMatch(a -> QitsConfig.isConfigName(a.name)));
    assertTrue(
        actions.stream().anyMatch(a -> a.name.equals(QitsConfig.configName("build-project"))));
    assertEquals(
        "./mvnw package",
        actions.stream()
            .filter(a -> a.name.equals(QitsConfig.configName("build-project")))
            .findFirst()
            .orElseThrow()
            .executeScript);

    List<RepositoryDaemon> daemons = repoDaemons(repo.id);
    assertEquals(1, daemons.size());
    RepositoryDaemon dev = daemons.get(0);
    assertEquals(QitsConfig.configName("dev-server"), dev.name);
    assertTrue(dev.otel);
    assertEquals(4200, dev.webView.port);
    assertEquals(1, dev.observers.size());
    assertEquals(1, dev.sources.size());

    // Repository-level field the file owns (file wins).
    assertEquals(RepositoryArchetype.SERVICE_TEMPLATE, freshRepo(repo.id).archetype);
    assertNull(freshRepo(repo.id).configWarning);
  }

  @Test
  public void reloadIsIdempotentAndKeepsIds() throws Exception {
    var project = projectService.create("Cfg Idempotent", null);
    Repository repo = repositoryService.cloneRepository(source(CONFIG), null, project);

    Map<String, String> idsBefore =
        repoActions(repo.id).stream()
            .collect(java.util.stream.Collectors.toMap(a -> a.name, a -> a.id));
    String daemonId = repoDaemons(repo.id).get(0).id;

    reconciler.reload(repo.id);
    reconciler.reload(repo.id);

    assertEquals(2, repoActions(repo.id).size());
    for (ActionConfiguration a : repoActions(repo.id)) {
      assertEquals(idsBefore.get(a.name), a.id, "re-ingest keeps the same action id");
    }
    assertEquals(daemonId, repoDaemons(repo.id).get(0).id, "re-ingest keeps the same daemon id");
  }

  @Test
  public void syncRemovesUndeclaredButKeepsUserActions() throws Exception {
    var project = projectService.create("Cfg Sync", null);
    String src = source(CONFIG);
    Repository repo = repositoryService.cloneRepository(src, null, project);

    // A hand-made (UI) action must survive ingestion untouched.
    actionConfigurationService.createForRepository(
        repo.id, "hand-made", "kept", "echo hi", null, false, null);
    assertEquals(3, repoActions(repo.id).size());

    // Drop run-tests from the file, then pull → re-ingest.
    commit(
        src,
        """
        version: 1
        actions:
          - name: build-project
            execute: ./mvnw package
        """);
    repositoryService.pullRepository(repo.id);

    List<String> names = repoActions(repo.id).stream().map(a -> a.name).toList();
    assertTrue(names.contains(QitsConfig.configName("build-project")));
    assertFalse(
        names.contains(QitsConfig.configName("run-tests")), "undeclared config action removed");
    assertTrue(names.contains("hand-made"), "UI action untouched");
    // Daemons all removed (none declared in the new file).
    assertTrue(repoDaemons(repo.id).isEmpty());
  }

  @Test
  public void invalidDaemonKeepsLastGoodAndRecordsWarning() throws Exception {
    var project = projectService.create("Cfg Invalid", null);
    String src = source(CONFIG);
    Repository repo = repositoryService.cloneRepository(src, null, project);
    assertNull(freshRepo(repo.id).configWarning);

    // A daemon with an invalid regex ready-pattern must not fail the sync, and must not clobber the
    // last-good row.
    commit(
        src,
        """
        version: 1
        daemons:
          - name: dev-server
            start: ./mvnw quarkus:dev
            ready-pattern: "([unclosed"
        """);
    repositoryService.pullRepository(repo.id);

    Repository after = freshRepo(repo.id);
    assertNotNull(after.configWarning);
    assertTrue(after.configWarning.contains("dev-server"));
    // The previously-good daemon row is still there with its old ready-pattern.
    RepositoryDaemon dev = repoDaemons(repo.id).get(0);
    assertEquals("Listening on", dev.readyPattern);
  }

  @Test
  public void cloneIngestsOrderedBootstrapChain() throws Exception {
    var project = projectService.create("Cfg Bootstrap", null);
    Repository repo =
        repositoryService.cloneRepository(
            source(
                """
                version: 1
                bootstrap:
                  - name: install
                    execute: ./mvnw install -DskipTests
                    environment:
                      MAVEN_OPTS: -Xmx2g
                  - name: seed
                    execute: ./mvnw -pl cli quarkus:run -Dcli.args=seed
                    check: test ! -f marker
                """),
            null,
            project);

    List<BootstrapCommand> chain = repoBootstrap(repo.id);
    assertEquals(2, chain.size());
    assertTrue(chain.stream().allMatch(c -> QitsConfig.isConfigName(c.name)));
    // File position = execution order = orderIndex.
    assertEquals(QitsConfig.configName("install"), chain.get(0).name);
    assertEquals(0, chain.get(0).orderIndex);
    assertEquals("-Xmx2g", chain.get(0).environment.get("MAVEN_OPTS"));
    assertNull(chain.get(0).checkScript);
    assertEquals(QitsConfig.configName("seed"), chain.get(1).name);
    assertEquals(1, chain.get(1).orderIndex);
    assertEquals("test ! -f marker", chain.get(1).checkScript);
  }

  @Test
  public void reorderedFileRestampsIndicesKeepingIdsAndRemovesUndeclared() throws Exception {
    var project = projectService.create("Cfg Bootstrap Reorder", null);
    String src =
        source(
            """
            version: 1
            bootstrap:
              - name: install
                execute: ./mvnw install
              - name: seed
                execute: ./seed
            """);
    Repository repo = repositoryService.cloneRepository(src, null, project);
    Map<String, String> idsBefore =
        repoBootstrap(repo.id).stream()
            .collect(java.util.stream.Collectors.toMap(c -> c.name, c -> c.id));

    // A hand-made (UI) command must survive ingestion untouched.
    bootstrapCommandService.create(repo.id, "hand-made", null, "echo hi", null, null, null);

    // Swap the order and drop nothing; then drop `install` entirely.
    commit(
        src,
        """
        version: 1
        bootstrap:
          - name: seed
            execute: ./seed
          - name: install
            execute: ./mvnw install
        """);
    repositoryService.pullRepository(repo.id);

    List<BootstrapCommand> swapped =
        repoBootstrap(repo.id).stream().filter(c -> QitsConfig.isConfigName(c.name)).toList();
    assertEquals(QitsConfig.configName("seed"), swapped.get(0).name);
    assertEquals(0, swapped.get(0).orderIndex);
    assertEquals(QitsConfig.configName("install"), swapped.get(1).name);
    assertEquals(1, swapped.get(1).orderIndex);
    assertEquals(idsBefore.get(QitsConfig.configName("seed")), swapped.get(0).id);
    assertEquals(idsBefore.get(QitsConfig.configName("install")), swapped.get(1).id);

    commit(
        src,
        """
        version: 1
        bootstrap:
          - name: seed
            execute: ./seed
        """);
    repositoryService.pullRepository(repo.id);

    List<String> names = repoBootstrap(repo.id).stream().map(c -> c.name).toList();
    assertTrue(names.contains(QitsConfig.configName("seed")));
    assertFalse(
        names.contains(QitsConfig.configName("install")), "undeclared config command removed");
    assertTrue(names.contains("hand-made"), "UI command untouched");
  }

  @Test
  public void reingestPreservesUserReorderWithoutIndexCollision() throws Exception {
    var project = projectService.create("Cfg Bootstrap Collide", null);
    Repository repo =
        repositoryService.cloneRepository(
            source(
                """
                version: 1
                bootstrap:
                  - name: c0
                    execute: ./c0
                  - name: c1
                    execute: ./c1
                """),
            null,
            project);

    // The user adds a UI command and drags it to the very front, so the whole chain is re-stamped
    // (u=0, c0=1, c1=2) and a UI-origin command now sits ahead of the config block.
    String uiId = bootstrapCommandService.create(repo.id, "u", null, "./u", null, null, null).id;
    List<String> front = new java.util.ArrayList<>();
    front.add(uiId);
    repoBootstrap(repo.id).stream()
        .map(c -> c.id)
        .filter(id -> !id.equals(uiId))
        .forEach(front::add);
    bootstrapCommandService.reorder(repo.id, front);

    // A plain sync re-ingests the unchanged config. It must NOT re-stamp c0/c1 back to 0/1 (which
    // would collide with u at 0 and scramble the order): u stays ahead, config order is preserved,
    // and every index is unique.
    reconciler.reload(repo.id);

    List<BootstrapCommand> chain = repoBootstrap(repo.id);
    assertEquals(
        List.of("u", QitsConfig.configName("c0"), QitsConfig.configName("c1")),
        chain.stream().map(c -> c.name).toList(),
        "the user's reorder survives re-ingest and config order is preserved");
    assertEquals(
        chain.size(),
        chain.stream().map(c -> c.orderIndex).distinct().count(),
        "no two commands share an orderIndex");
  }

  @Test
  public void invalidBootstrapEntryWarnsAndKeepsRest() throws Exception {
    var project = projectService.create("Cfg Bootstrap Invalid", null);
    Repository repo =
        repositoryService.cloneRepository(
            source(
                """
                version: 1
                bootstrap:
                  - name: broken
                  - name: good
                    execute: ./go
                """),
            null,
            project);

    // `broken` has no execute → per-entry warning; `good` still lands, as the chain's only entry.
    Repository after = freshRepo(repo.id);
    assertNotNull(after.configWarning);
    assertTrue(after.configWarning.contains("broken"));
    List<BootstrapCommand> chain = repoBootstrap(repo.id);
    assertEquals(1, chain.size());
    assertEquals(QitsConfig.configName("good"), chain.get(0).name);
    assertEquals(0, chain.get(0).orderIndex, "skipped entries leave no orderIndex gap");
  }

  @Test
  public void absentFileIsCleanNoOp() throws Exception {
    var project = projectService.create("Cfg Absent", null);
    Repository repo = repositoryService.cloneRepository(source(null), null, project);
    assertTrue(repoActions(repo.id).isEmpty());
    assertTrue(repoDaemons(repo.id).isEmpty());
    assertNull(freshRepo(repo.id).configWarning);
  }

  @Test
  public void writeApiRejectsReservedSuffix() throws Exception {
    var project = projectService.create("Cfg Guard", null);
    Repository repo = repositoryService.cloneRepository(source(null), null, project);

    assertThrows(
        BadRequestException.class,
        () ->
            actionConfigurationService.createForRepository(
                repo.id,
                "sneaky" + QitsConfig.CONFIG_NAME_SUFFIX,
                null,
                "echo",
                null,
                false,
                null));
    assertThrows(
        BadRequestException.class,
        () ->
            repositoryDaemonService.create(
                repo.id,
                "sneaky" + QitsConfig.CONFIG_NAME_SUFFIX,
                null,
                "run",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    assertThrows(
        BadRequestException.class,
        () ->
            bootstrapCommandService.create(
                repo.id, "sneaky" + QitsConfig.CONFIG_NAME_SUFFIX, null, "echo", null, null, null));
  }
}
