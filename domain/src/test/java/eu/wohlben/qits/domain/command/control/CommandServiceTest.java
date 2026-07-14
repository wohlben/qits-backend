package eu.wohlben.qits.domain.command.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
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
 * Verifies the registry-backed command lifecycle against a real cloned-fixture workspace: a
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

  @Inject WorkspaceService workspaceService;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject CommandService commandService;

  @Inject CommandRegistry commandRegistry;

  @Inject CommandLifecycleService commandLifecycleService;

  /** Clones the fixture and adds a {@code work} workspace (off master) to run commands in. */
  private String repoWithWorkspace() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Command Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    workspaceService.createWorkspace(repo.id, "work", "master", "work");
    return repo.id;
  }

  private String createAction(String repoId, String name, String script, boolean interactive) {
    return actionConfigurationService.createForRepository(
            repoId, name, null, script, null, interactive, null)
        .id;
  }

  @Test
  public void launchAndAwaitRunsAndRecordsTheCommand() throws Exception {
    String repoId = repoWithWorkspace();
    String actionId = createAction(repoId, "echo", "echo hello-cmd", false);

    var outcome = commandService.launchAndAwait(repoId, "work", actionId);

    assertEquals(0, outcome.exitCode());
    assertTrue(outcome.output().contains("hello-cmd"), "output: " + outcome.output());

    List<CommandDto> commands = commandService.list(repoId, null, null);
    assertEquals(1, commands.size(), "one command should be recorded");
    CommandDto command = commands.get(0);
    assertEquals(CommandStatus.EXITED, command.status());
    assertEquals(Integer.valueOf(0), command.exitCode());
    assertEquals("work", command.workspaceId());
    assertEquals("work", command.branch());
    assertEquals(40, command.commitHash().length(), "full SHA captured: " + command.commitHash());
  }

  @Test
  public void capturesTheOutputLog() throws Exception {
    String repoId = repoWithWorkspace();
    String actionId = createAction(repoId, "echo", "echo hello-log", false);

    commandService.launchAndAwait(repoId, "work", actionId);
    String commandId = commandService.list(repoId, null, null).get(0).id();

    // The line log is written asynchronously, so poll briefly for it to flush.
    List<CommandLogLineDto> lines = awaitLog(commandId);
    assertTrue(
        lines.stream()
            .anyMatch(l -> l.channel() == LogChannel.OUTPUT && l.content().contains("hello-log")),
        "captured output should contain the echoed line: " + lines);
  }

  @Test
  public void launchChatRecordsAChatCommandAndPersistsOnlyErrorResults() throws Exception {
    String repoId = repoWithWorkspace();

    // A stand-in stream-json process (no real claude in the test). Ordinary events stay
    // ring+broadcast only — the durable record is the transcript import — but the failure result
    // (absent from any transcript) still persists to OUTPUT so its error bubble survives replay.
    CommandDto command =
        commandService.launchChat(
            repoId,
            "work",
            "Claude chat",
            "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\"}'"
                + " '{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"boom\"}'",
            Map.of());

    assertEquals(CommandKind.CHAT, command.kind());

    List<CommandLogLineDto> lines = awaitLog(command.id());
    assertTrue(
        lines.stream().anyMatch(l -> l.content().contains("\"boom\"")),
        "the failure result must persist: " + lines);
    assertTrue(
        lines.stream().noneMatch(l -> l.content().contains("\"subtype\":\"init\"")),
        "ordinary stream events must no longer persist: " + lines);
  }

  @Test
  public void chatLogRoundTripsErrorResultsLargerThan64KbUntruncated() throws Exception {
    String repoId = repoWithWorkspace();

    // A persisted event well past the old 64 KB truncation cap, which used to corrupt the stored
    // line into invalid JSON.
    CommandDto command =
        commandService.launchChat(
            repoId,
            "work",
            "Claude chat",
            "printf '{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"%s\"}\\n'"
                + " \"$(head -c 70000 /dev/zero | tr '\\0' x)\"",
            Map.of());

    List<CommandLogLineDto> lines = awaitLog(command.id());
    CommandLogLineDto big =
        lines.stream()
            .filter(l -> l.content().length() > 64 * 1024)
            .findFirst()
            .orElseThrow(
                () -> new AssertionError("no un-truncated large line persisted: " + lines));
    var event = new com.fasterxml.jackson.databind.ObjectMapper().readTree(big.content());
    assertEquals(70000, event.get("result").asText().length(), "stored event must be intact JSON");
  }

  @Test
  public void daemonLaunchWithOtelInjectsExporterEnvAndUserOverridesWin() throws Exception {
    String repoId = repoWithWorkspace();

    // The daemon's own environment overrides one injected var — the definition overlay must win.
    CommandDto command =
        commandService.launchDaemon(
            repoId,
            "work",
            "otel daemon",
            "env",
            Map.of("OTEL_SERVICE_NAME", "user-override"),
            true,
            null,
            (commandId, exitCode, terminatedManually) -> {},
            null);

    List<CommandLogLineDto> lines = awaitStableLog(command.id());
    String env = lines.stream().map(CommandLogLineDto::content).reduce("", (a, b) -> a + "\n" + b);
    assertTrue(
        env.contains("OTEL_EXPORTER_OTLP_ENDPOINT=http://"), "endpoint must be injected: " + env);
    assertTrue(env.contains("/api/otel"), "endpoint must point at the receiver: " + env);
    assertTrue(env.contains("OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf"), env);
    assertTrue(
        env.contains("qits.command.id=" + command.id()),
        "resource attributes must carry the persisted command id: " + env);
    assertTrue(
        env.contains("qits.workspace.id=work,qits.repository.id=" + repoId),
        "resource attributes must carry workspace + repository: " + env);
    assertTrue(
        env.contains("OTEL_SERVICE_NAME=user-override"),
        "an explicit user OTEL_* var must beat the injected one: " + env);
  }

  @Test
  public void daemonLaunchWithoutOtelInjectsNothing() throws Exception {
    String repoId = repoWithWorkspace();

    CommandDto command =
        commandService.launchDaemon(
            repoId,
            "work",
            "plain daemon",
            "env",
            Map.of(),
            false,
            null,
            (commandId, exitCode, terminatedManually) -> {},
            null);

    List<CommandLogLineDto> lines = awaitStableLog(command.id());
    assertTrue(
        lines.stream().noneMatch(l -> l.content().contains("OTEL_EXPORTER_OTLP_ENDPOINT")),
        "no OTEL env without the toggle: " + lines);
    assertTrue(
        lines.stream().noneMatch(l -> l.content().contains("QITS_PUBLIC_BASE")),
        "no public base without one: " + lines);
  }

  @Test
  public void daemonLaunchInjectsCaptureEndpointRegardlessOfOtelAndUserOverrideWins()
      throws Exception {
    String repoId = repoWithWorkspace();

    // otel toggle OFF: the capture endpoint is injected unconditionally for daemons (like TERM).
    CommandDto command =
        commandService.launchDaemon(
            repoId,
            "work",
            "capture daemon",
            "env",
            Map.of(),
            false,
            null,
            (commandId, exitCode, terminatedManually) -> {},
            null);

    List<CommandLogLineDto> lines = awaitStableLog(command.id());
    String env = lines.stream().map(CommandLogLineDto::content).reduce("", (a, b) -> a + "\n" + b);
    assertTrue(
        env.contains("QITS_CAPTURE_ENDPOINT=http://"),
        "capture endpoint must be injected without the otel toggle: " + env);
    assertTrue(env.contains("/api/capture"), "endpoint must point at the ingest: " + env);

    // Definition overlay wins, like OTEL_* / QITS_PUBLIC_BASE.
    CommandDto overridden =
        commandService.launchDaemon(
            repoId,
            "work",
            "capture daemon override",
            "env",
            Map.of("QITS_CAPTURE_ENDPOINT", "http://user-override/api/capture"),
            false,
            null,
            (commandId, exitCode, terminatedManually) -> {},
            null);
    String overriddenEnv =
        awaitStableLog(overridden.id()).stream()
            .map(CommandLogLineDto::content)
            .reduce("", (a, b) -> a + "\n" + b);
    assertTrue(
        overriddenEnv.contains("QITS_CAPTURE_ENDPOINT=http://user-override/api/capture"),
        "an explicit user var must beat the injected one: " + overriddenEnv);
  }

  @Test
  public void daemonLaunchWithPublicBaseInjectsIt() throws Exception {
    String repoId = repoWithWorkspace();

    CommandDto command =
        commandService.launchDaemon(
            repoId,
            "work",
            "web daemon",
            "env",
            Map.of(),
            false,
            "/daemon/work/some-daemon-id/",
            (commandId, exitCode, terminatedManually) -> {},
            null);

    List<CommandLogLineDto> lines = awaitStableLog(command.id());
    assertTrue(
        lines.stream()
            .anyMatch(l -> l.content().contains("QITS_PUBLIC_BASE=/daemon/work/some-daemon-id/")),
        "the proxied base path must be injected: " + lines);
  }

  /** Awaits the async log until its size is stable across two polls (the `env` dump is large). */
  private List<CommandLogLineDto> awaitStableLog(String commandId) throws InterruptedException {
    List<CommandLogLineDto> previous = awaitLog(commandId);
    for (int i = 0; i < 40; i++) {
      Thread.sleep(100);
      List<CommandLogLineDto> current = commandService.log(commandId, null);
      if (!current.isEmpty() && current.size() == previous.size()) {
        return current;
      }
      previous = current;
    }
    return previous;
  }

  private List<CommandLogLineDto> awaitLog(String commandId) throws InterruptedException {
    for (int i = 0; i < 40; i++) {
      List<CommandLogLineDto> lines = commandService.log(commandId, null);
      if (!lines.isEmpty()) {
        return lines;
      }
      Thread.sleep(100);
    }
    return commandService.log(commandId, null);
  }

  @Test
  public void detachKeepsRunningAndTerminateStops() throws Exception {
    String repoId = repoWithWorkspace();
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
    String repoId = repoWithWorkspace();
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
