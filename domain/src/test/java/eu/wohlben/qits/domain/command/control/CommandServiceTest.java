package eu.wohlben.qits.domain.command.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.featureflow.control.RepositoryActionService;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
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
 * Verifies the registry-backed command lifecycle against a real cloned-fixture worktree: a
 * non-interactive run records its result, a running command survives a detach and stops on
 * terminate, and startup reconciliation marks orphaned RUNNING rows as INTERRUPTED.
 */
@QuarkusTest
@TestProfile(CommandServiceTest.TestProfile.class)
public class CommandServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-command-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject WorktreeService worktreeService;

  @Inject RepositoryActionService repositoryActionService;

  @Inject CommandService commandService;

  @Inject CommandRegistry commandRegistry;

  @Inject CommandLifecycleService commandLifecycleService;

  /** Clones the fixture and adds a {@code work} worktree (off master) to run commands in. */
  private String repoWithWorktree() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Command Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    worktreeService.createWorktree(repo.id, "work", "master", "work");
    return repo.id;
  }

  private String createAction(String repoId, String name, String script, boolean interactive) {
    return repositoryActionService.create(repoId, name, null, script, null, interactive, null).id;
  }

  @Test
  public void launchAndAwaitRunsAndRecordsTheCommand() throws Exception {
    String repoId = repoWithWorktree();
    String actionId = createAction(repoId, "echo", "echo hello-cmd", false);

    var outcome = commandService.launchAndAwait(repoId, "work", actionId);

    assertEquals(0, outcome.exitCode());
    assertTrue(outcome.output().contains("hello-cmd"), "output: " + outcome.output());

    List<CommandDto> commands = commandService.list(repoId, null);
    assertEquals(1, commands.size(), "one command should be recorded");
    CommandDto command = commands.get(0);
    assertEquals(CommandStatus.EXITED, command.status());
    assertEquals(Integer.valueOf(0), command.exitCode());
    assertEquals("work", command.worktreeId());
    assertEquals("work", command.branch());
    assertEquals(40, command.commitHash().length(), "full SHA captured: " + command.commitHash());
  }

  @Test
  public void capturesTheOutputLog() throws Exception {
    String repoId = repoWithWorktree();
    String actionId = createAction(repoId, "echo", "echo hello-log", false);

    commandService.launchAndAwait(repoId, "work", actionId);
    String commandId = commandService.list(repoId, null).get(0).id();

    // The line log is written asynchronously, so poll briefly for it to flush.
    List<CommandLogLineDto> lines = awaitLog(commandId);
    assertTrue(
        lines.stream()
            .anyMatch(l -> l.channel() == LogChannel.OUTPUT && l.content().contains("hello-log")),
        "captured output should contain the echoed line: " + lines);
  }

  @Test
  public void launchChatRecordsAChatCommandAndCapturesItsJsonLines() throws Exception {
    String repoId = repoWithWorktree();

    // A stand-in stream-json process: emit two event lines and exit (no real claude in the test).
    CommandDto command =
        commandService.launchChat(
            repoId,
            "work",
            "Claude chat",
            "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\"}' '{\"type\":\"result\"}'",
            Map.of());

    assertEquals(CommandKind.CHAT, command.kind());

    // The conversation is persisted as OUTPUT log lines (raw JSON) so a finished chat can be
    // replayed.
    List<CommandLogLineDto> lines = awaitLog(command.id());
    assertTrue(
        lines.stream().anyMatch(l -> l.content().contains("\"subtype\":\"init\"")),
        "captured JSONL should include the init event: " + lines);
    assertTrue(
        lines.stream().anyMatch(l -> l.content().contains("\"type\":\"result\"")),
        "captured JSONL should include the result event: " + lines);
  }

  private List<CommandLogLineDto> awaitLog(String commandId) throws InterruptedException {
    for (int i = 0; i < 40; i++) {
      List<CommandLogLineDto> lines = commandService.log(commandId);
      if (!lines.isEmpty()) {
        return lines;
      }
      Thread.sleep(100);
    }
    return commandService.log(commandId);
  }

  @Test
  public void detachKeepsRunningAndTerminateStops() throws Exception {
    String repoId = repoWithWorktree();
    String actionId = createAction(repoId, "sleep", "sleep 30", true);

    CommandDto launched = commandService.launch(repoId, "work", actionId);
    assertEquals(CommandStatus.RUNNING, launched.status());
    assertTrue(commandRegistry.isRunning(launched.id()));

    // A viewer attaching and then leaving (detach) must NOT kill the process — the core of the
    // persistent model: leaving the terminal route no longer terminates the command.
    CommandOutputSink viewer =
        new CommandOutputSink() {
          @Override
          public void write(String data) {}

          @Override
          public boolean isOpen() {
            return true;
          }
        };
    commandRegistry.attach(launched.id(), viewer);
    commandRegistry.detach(launched.id(), viewer);
    assertTrue(commandRegistry.isRunning(launched.id()), "detach must not terminate the process");

    CommandDto terminated = commandService.terminate(launched.id());
    assertEquals(CommandStatus.TERMINATED, terminated.status());
    assertFalse(commandRegistry.isRunning(launched.id()));
  }

  @Test
  public void startupReconciliationMarksOrphanedRunningAsInterrupted() throws Exception {
    String repoId = repoWithWorktree();
    String actionId = createAction(repoId, "sleep", "sleep 30", true);
    CommandDto launched = commandService.launch(repoId, "work", actionId);
    assertEquals(CommandStatus.RUNNING, commandService.get(launched.id()).status());

    // Simulates a JVM restart: the registry is conceptually empty, so the persisted RUNNING row is
    // an orphan and is reconciled to INTERRUPTED.
    int reconciled = commandLifecycleService.reconcileRunningAsInterrupted();
    assertTrue(reconciled >= 1, "should reconcile at least the launched command");
    assertEquals(CommandStatus.INTERRUPTED, commandService.get(launched.id()).status());

    commandRegistry.terminate(launched.id()); // clean up the still-running OS process
  }
}
