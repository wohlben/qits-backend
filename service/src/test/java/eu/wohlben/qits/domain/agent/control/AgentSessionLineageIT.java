package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Real-CLI integration test for the session-lineage contract {@link ClaudeCodeAgent} encodes: a
 * qits-pinned {@code --session-id} lands the transcript exactly where {@code transcriptPath} says
 * (on the shared claude volume), {@code --resume} appends to the same file, a Task-spawning prompt
 * produces {@code subagentsDir} sidechains, and a {@code --settings} SessionStart hook delivers
 * {@code {source, session_id, transcript_path}}. Upgrading the pinned CLI version in {@code
 * docker/workspace} re-runs this gate — the conventions are internal to Claude Code, so this is the
 * regression net for drift.
 *
 * <p>Part of the <strong>extended</strong> suite ({@code ./mvnw verify -Pextended}); self-skips
 * when docker, the {@code qits/workspace} image, or a signed-in shared claude volume is absent.
 * Deliberately drives {@code docker run} directly (no workspace machinery) — the unit under test is
 * the CLI's on-disk convention, not qits' container plumbing.
 */
@Tag("extended")
public class AgentSessionLineageIT {

  private static final String IMAGE =
      System.getProperty("qits.workspace.image", "qits/workspace:latest");
  private static final String RUNTIME =
      System.getProperty("qits.workspace.container-runtime", "docker");
  private static final String VOLUME =
      System.getProperty("qits.workspace.claude-volume", "qits_shared_dot_claude");
  private static final String MOUNT = "/claude-home";
  private static final String CONFIG_DIR = MOUNT + "/.claude";
  private static final String CWD = "/workspace";

  private final ClaudeCodeAgent agent = new ClaudeCodeAgent();

  private record Run(int exitCode, String output) {}

  /**
   * One {@code docker run --rm} with the shared claude volume + config-dir env, as the host uid.
   */
  private Run inContainer(long timeoutSeconds, String... command) throws Exception {
    List<String> argv = new ArrayList<>();
    argv.addAll(
        List.of(
            RUNTIME,
            "run",
            "--rm",
            "--user",
            hostUid(),
            "-v",
            VOLUME + ":" + MOUNT,
            "-e",
            "CLAUDE_CONFIG_DIR=" + CONFIG_DIR,
            "-e",
            "HOME=" + MOUNT,
            "-w",
            CWD,
            IMAGE));
    argv.addAll(List.of(command));
    Process process = new ProcessBuilder(argv).redirectErrorStream(true).start();
    String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertTrue(process.waitFor(timeoutSeconds, TimeUnit.SECONDS), "timed out: " + output);
    return new Run(process.exitValue(), output);
  }

  private static String hostUid() {
    try {
      Object uid =
          java.nio.file.Files.getAttribute(
              java.nio.file.Path.of(System.getProperty("user.home")), "unix:uid");
      return String.valueOf(((Number) uid).longValue());
    } catch (Exception e) {
      return "1000";
    }
  }

  private boolean backendAvailable() {
    try {
      Process image = new ProcessBuilder(RUNTIME, "image", "inspect", IMAGE).start();
      if (image.waitFor() != 0) {
        return false;
      }
      // The IT drives the real CLI, which needs the one-time OAuth login on the shared volume.
      return inContainer(60, "claude", "auth", "status").exitCode() == 0;
    } catch (Exception e) {
      return false;
    }
  }

  /** The container path of a session's transcript per the harness-owned convention. */
  private String transcriptPath(String sessionId) {
    return CONFIG_DIR + "/" + agent.transcriptPath(CWD, sessionId);
  }

  @Test
  public void pinnedSessionPersistsAtThePredictedPathResumesInPlaceAndReportsViaHook()
      throws Exception {
    assumeTrue(backendAvailable(), "docker + " + IMAGE + " + a signed-in claude volume required");

    String sessionId = UUID.randomUUID().toString();
    String hookFile = MOUNT + "/it-hook-" + sessionId + ".json";
    String hookSettings =
        "{\"hooks\":{\"SessionStart\":[{\"hooks\":[{\"type\":\"command\",\"command\":"
            + "\"cat > "
            + hookFile
            + "\"}]}]}}";
    try {
      // 1. Pin a fresh session and let the SessionStart hook write its stdin JSON to the volume.
      Run pinned =
          inContainer(
              300,
              "claude",
              "-p",
              "Reply with exactly: ok",
              "--session-id",
              sessionId,
              "--settings",
              hookSettings,
              "--dangerously-skip-permissions");
      assertEquals(0, pinned.exitCode(), pinned.output());

      // The transcript exists exactly where transcriptPath says.
      String transcript = transcriptPath(sessionId);
      assertEquals(
          0,
          inContainer(60, "test", "-s", transcript).exitCode(),
          "transcript expected at " + transcript);
      String sizeBefore = inContainer(60, "stat", "-c", "%s", transcript).output().trim();

      // The hook delivered the session identity: session_id + the absolute transcript_path.
      Run hook = inContainer(60, "cat", hookFile);
      assertEquals(0, hook.exitCode(), "the SessionStart hook should have written " + hookFile);
      assertTrue(hook.output().contains("\"session_id\":\"" + sessionId + "\""), hook.output());
      assertTrue(
          hook.output().contains("\"transcript_path\":\"" + transcript + "\""), hook.output());
      assertTrue(hook.output().contains("\"hook_event_name\":\"SessionStart\""), hook.output());

      // 2. Resume in place: same session id, same JSONL file, appended.
      Run resumed =
          inContainer(
              300,
              "claude",
              "-p",
              "Reply with exactly: ok again",
              "--resume",
              sessionId,
              "--dangerously-skip-permissions");
      assertEquals(0, resumed.exitCode(), resumed.output());
      String sizeAfter = inContainer(60, "stat", "-c", "%s", transcript).output().trim();
      assertTrue(
          Long.parseLong(sizeAfter) > Long.parseLong(sizeBefore),
          "resume should append to the same transcript (" + sizeBefore + " -> " + sizeAfter + ")");
    } finally {
      inContainer(60, "rm", "-f", hookFile);
    }
  }

  @Test
  public void aTaskSpawningPromptPersistsSidechainsUnderTheSubagentsDir() throws Exception {
    assumeTrue(backendAvailable(), "docker + " + IMAGE + " + a signed-in claude volume required");

    String sessionId = UUID.randomUUID().toString();
    Run run =
        inContainer(
            600,
            "claude",
            "-p",
            "Use the Task tool to launch exactly one general-purpose subagent whose task is:"
                + " reply with the word done. Then reply done yourself.",
            "--session-id",
            sessionId,
            "--dangerously-skip-permissions");
    assertEquals(0, run.exitCode(), run.output());

    String subagentsDir = CONFIG_DIR + "/" + agent.subagentsDir(CWD, sessionId);
    Run sidechains =
        inContainer(60, "sh", "-lc", "ls " + subagentsDir + "/agent-*.jsonl | head -1");
    assertEquals(
        0,
        sidechains.exitCode(),
        "expected a sidechain under " + subagentsDir + ": " + run.output());
    // The sibling meta file carries the label the transcript import folds in.
    Run meta = inContainer(60, "sh", "-lc", "ls " + subagentsDir + "/agent-*.meta.json | head -1");
    assertEquals(0, meta.exitCode(), "expected a sidechain meta file under " + subagentsDir);
  }
}
