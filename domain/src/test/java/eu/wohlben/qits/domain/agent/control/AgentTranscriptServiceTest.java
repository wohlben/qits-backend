package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.agent.entity.AgentSessionStat;
import eu.wohlben.qits.domain.agent.persistence.AgentSessionStatRepository;
import eu.wohlben.qits.domain.command.control.CommandLogService;
import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.Workspace;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Exercises the post-exit transcript sweep against a temp-dir "config dir" shaped like the real
 * claude volume ({@code projects/-workspace/<sessionId>.jsonl} + {@code <sessionId>/subagents/}).
 */
@QuarkusTest
public class AgentTranscriptServiceTest {

  @Inject AgentTranscriptService agentTranscriptService;

  @Inject CommandService commandService;

  @Inject CommandLogService commandLogService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @Inject AgentSessionStatRepository statRepository;

  @TempDir Path configDir;

  /** Seeds a finished agent command whose session list is exactly {@code refs}. */
  String seedCommand(List<AgentSessionRef> refs) {
    return seedCommand(refs, CommandKind.CHAT);
  }

  @Transactional
  String seedCommand(List<AgentSessionRef> refs, CommandKind kind) {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Transcript project";
    projectRepository.persist(project);

    Repository repository = new Repository();
    repository.id = UUID.randomUUID().toString();
    repository.url = "https://example.com/repo.git";
    repository.project = project;
    repositoryRepository.persist(repository);

    Workspace workspace = new Workspace();
    workspace.workspaceId = "work";
    workspace.repository = repository;
    workspace.branch = "feature/x";
    workspaceRepository.persist(workspace);

    Command command =
        Command.builder()
            .id(UUID.randomUUID().toString())
            .workspace(workspace)
            .branch("feature/x")
            .commitHash("abcdef1234567890")
            .actionName("Claude Code (repository MCP)")
            .executeScript("exec claude")
            .interactive(false)
            .kind(kind)
            .status(CommandStatus.EXITED)
            .build();
    command.agentSessions.addAll(refs);
    commandRepository.persist(command);
    return command.id;
  }

  private static AgentSessionRef pinned(String sessionId) {
    return new AgentSessionRef(sessionId, AgentSessionSource.PINNED, null, null, Instant.now());
  }

  /** A transcript line in the wrapped persistence shape (sessionId + timestamp + envelope). */
  private static String line(String sessionId, String text) {
    return "{\"parentUuid\":null,\"sessionId\":\""
        + sessionId
        + "\",\"isSidechain\":false,\"timestamp\":\"2026-07-10T08:00:00.000Z\",\"type\":\"assistant\","
        + "\"message\":{\"content\":[{\"type\":\"text\",\"text\":\""
        + text
        + "\"}]}}";
  }

  /** A user turn with plain-string content (the shape the CLI writes for typed prompts). */
  private static String userLine(String sessionId, String text) {
    return "{\"sessionId\":\""
        + sessionId
        + "\",\"isSidechain\":false,\"timestamp\":\"2026-07-10T07:59:00.000Z\",\"type\":\"user\","
        + "\"message\":{\"role\":\"user\",\"content\":\""
        + text
        + "\"}}";
  }

  /** A tool-result carrier — typed {@code user} but not a conversation turn. */
  private static String toolResultLine(String sessionId) {
    return "{\"sessionId\":\""
        + sessionId
        + "\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":"
        + "[{\"type\":\"tool_result\",\"tool_use_id\":\"toolu_1\",\"content\":\"ok\"}]}}";
  }

  /** A meta line (harness-injected context, {@code isMeta: true}) — not a conversation turn. */
  private static String metaLine(String sessionId) {
    return "{\"sessionId\":\""
        + sessionId
        + "\",\"type\":\"user\",\"isMeta\":true,"
        + "\"message\":{\"role\":\"user\",\"content\":\"Caveat: local command output\"}}";
  }

  private Path conventionalTranscript(String sessionId) throws IOException {
    Path file = configDir.resolve(Path.of("projects", "-workspace", sessionId + ".jsonl"));
    Files.createDirectories(file.getParent());
    return file;
  }

  private List<CommandLogLineDto> transcriptLines(String commandId) {
    return commandService.log(commandId, null, LogChannel.TRANSCRIPT);
  }

  @Test
  public void importsTheMainTranscriptOntoTheTranscriptChannel() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(
        conventionalTranscript(sessionId), List.of(line(sessionId, "one"), line(sessionId, "two")));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(2, lines.size());
    assertTrue(lines.get(0).content().contains("one"));
    assertTrue(lines.get(1).content().contains("two"));
    // The TRANSCRIPT sequence space is disjoint from live stdio (which starts at 0 per run).
    assertEquals(AgentTranscriptService.TRANSCRIPT_SEQ_BASE, lines.get(0).sequence());
    assertEquals(AgentTranscriptService.TRANSCRIPT_SEQ_BASE + 1, lines.get(1).sequence());
    // The line's own timestamp field wins over the import time.
    assertEquals(Instant.parse("2026-07-10T08:00:00.000Z"), lines.get(0).timestamp());
  }

  @Test
  public void aMultiSessionCommandImportsEverySessionInListOrder() throws IOException {
    String first = UUID.randomUUID().toString();
    String second = UUID.randomUUID().toString();
    String commandId =
        seedCommand(
            List.of(
                pinned(first),
                new AgentSessionRef(
                    second, AgentSessionSource.SWITCHED, null, null, Instant.now())));
    Files.write(conventionalTranscript(first), List.of(line(first, "from-first")));
    Files.write(conventionalTranscript(second), List.of(line(second, "from-second")));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(2, lines.size());
    assertTrue(lines.get(0).content().contains("from-first"));
    assertTrue(lines.get(1).content().contains("from-second"));
  }

  @Test
  public void sidechainsImportBehindTheirSyntheticMetaLine() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(conventionalTranscript(sessionId), List.of(line(sessionId, "main")));
    Path subagents = configDir.resolve(Path.of("projects", "-workspace", sessionId, "subagents"));
    Files.createDirectories(subagents);
    Files.writeString(
        subagents.resolve("agent-a1b2.jsonl"),
        "{\"sessionId\":\""
            + sessionId
            + "\",\"isSidechain\":true,\"agentId\":\"a1b2\",\"type\":\"assistant\","
            + "\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"sidechain-work\"}]}}\n");
    Files.writeString(
        subagents.resolve("agent-a1b2.meta.json"),
        "{\"agentType\":\"Explore\",\"description\":\"scan the tests\","
            + "\"toolUseId\":\"toolu_123\",\"spawnDepth\":1}");

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(3, lines.size());
    String meta = lines.get(1).content();
    assertTrue(meta.contains(AgentTranscriptService.AGENT_META_TYPE), meta);
    assertTrue(meta.contains("\"agentId\":\"a1b2\""), meta);
    assertTrue(meta.contains("\"agentType\":\"Explore\""), meta);
    assertTrue(meta.contains("\"toolUseId\":\"toolu_123\""), meta);
    assertTrue(lines.get(2).content().contains("sidechain-work"));
  }

  @Test
  public void resweepingIsIdempotent() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(conventionalTranscript(sessionId), List.of(line(sessionId, "once")));

    agentTranscriptService.sweep(commandId, configDir);
    agentTranscriptService.sweep(commandId, configDir);

    assertEquals(1, transcriptLines(commandId).size());
  }

  @Test
  public void aConventionalPathMissFallsBackToTheFilenameLookup() throws IOException {
    // If the harness's cwd-escaping convention ever drifts, the exact-filename lookup under
    // projects/ recovers the file.
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Path oddDir = configDir.resolve(Path.of("projects", "some-future-escaping"));
    Files.createDirectories(oddDir);
    Files.write(oddDir.resolve(sessionId + ".jsonl"), List.of(line(sessionId, "recovered")));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size());
    assertTrue(lines.get(0).content().contains("recovered"));
  }

  @Test
  public void aHookReportedPathIsPreferredAndRemappedFromTheContainerMount() throws IOException {
    // The hook reports container-side paths (<claude-mount>/.claude/…); the sweep remaps them
    // onto its own config dir before falling back to the convention.
    String sessionId = UUID.randomUUID().toString();
    String commandId =
        seedCommand(
            List.of(
                new AgentSessionRef(
                    sessionId,
                    AgentSessionSource.PINNED,
                    null,
                    "/claude-home/.claude/projects/reported-here/" + sessionId + ".jsonl",
                    Instant.now())));
    Path reported = configDir.resolve(Path.of("projects", "reported-here"));
    Files.createDirectories(reported);
    Files.write(reported.resolve(sessionId + ".jsonl"), List.of(line(sessionId, "authoritative")));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size());
    assertTrue(lines.get(0).content().contains("authoritative"));
  }

  @Test
  public void anAbsentConfigDirSkipsTheImport() {
    String commandId = seedCommand(List.of(pinned(UUID.randomUUID().toString())));

    agentTranscriptService.sweep(commandId, configDir.resolve("does-not-exist"));

    assertEquals(0, transcriptLines(commandId).size());
  }

  @Test
  public void aCommandWithoutSessionsIsANoop() {
    String commandId = seedCommand(List.of());

    agentTranscriptService.sweep(commandId, configDir);

    assertEquals(0, transcriptLines(commandId).size());
  }

  @Test
  public void theSweepAggregatesASessionStatRowCountingConversationTurns() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(
        conventionalTranscript(sessionId),
        List.of(
            userLine(sessionId, "hello"),
            line(sessionId, "hi there"),
            toolResultLine(sessionId),
            metaLine(sessionId)));

    agentTranscriptService.sweep(commandId, configDir);

    List<AgentSessionStat> stats = statRepository.findBySessionIds(List.of(sessionId));
    assertEquals(1, stats.size());
    AgentSessionStat stat = stats.get(0);
    assertNull(stat.agentId);
    assertEquals(commandId, stat.commandId);
    // The user prompt and the assistant text turn count; the tool result and the meta line don't.
    assertEquals(2, stat.messageCount);
    // The first line's own timestamp, not the import time.
    assertEquals(Instant.parse("2026-07-10T07:59:00.000Z"), stat.firstTimestamp);
  }

  @Test
  public void sidechainsAggregateSubagentStatRowsCarryingTheirMetaLabels() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(conventionalTranscript(sessionId), List.of(line(sessionId, "main")));
    Path subagents = configDir.resolve(Path.of("projects", "-workspace", sessionId, "subagents"));
    Files.createDirectories(subagents);
    Files.writeString(
        subagents.resolve("agent-a1b2.jsonl"),
        "{\"sessionId\":\""
            + sessionId
            + "\",\"isSidechain\":true,\"agentId\":\"a1b2\",\"type\":\"assistant\","
            + "\"timestamp\":\"2026-07-10T08:01:00.000Z\","
            + "\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"sidechain-work\"}]}}\n");
    Files.writeString(
        subagents.resolve("agent-a1b2.meta.json"),
        "{\"agentType\":\"Explore\",\"description\":\"scan the tests\","
            + "\"toolUseId\":\"toolu_123\",\"spawnDepth\":1}");

    agentTranscriptService.sweep(commandId, configDir);

    List<AgentSessionStat> stats = statRepository.findBySessionIds(List.of(sessionId));
    assertEquals(2, stats.size());
    AgentSessionStat subagent =
        stats.stream().filter(s -> s.agentId != null).findFirst().orElseThrow();
    assertEquals("a1b2", subagent.agentId);
    assertEquals("Explore", subagent.agentType);
    assertEquals("scan the tests", subagent.description);
    assertEquals(1, subagent.messageCount);
    assertEquals(Instant.parse("2026-07-10T08:01:00.000Z"), subagent.firstTimestamp);
  }

  @Test
  public void resweepingReplacesStatRowsInsteadOfDuplicating() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(conventionalTranscript(sessionId), List.of(line(sessionId, "once")));

    agentTranscriptService.sweep(commandId, configDir);
    agentTranscriptService.sweep(commandId, configDir);

    List<AgentSessionStat> stats = statRepository.findBySessionIds(List.of(sessionId));
    assertEquals(1, stats.size());
    assertEquals(1, stats.get(0).messageCount);
  }

  @Test
  public void chatSweepSettlesUntilTheFileCatchesUpWithTheLiveTail() throws Exception {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Path file = conventionalTranscript(sessionId);
    Files.write(file, List.of(line(sessionId, "one")));

    // The harness flushes its JSONL asynchronously: the second line lands mid-settle.
    Thread lateFlush =
        new Thread(
            () -> {
              try {
                Thread.sleep(300);
                Files.write(
                    file, List.of(line(sessionId, "two")), java.nio.file.StandardOpenOption.APPEND);
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            });
    lateFlush.start();
    agentTranscriptService.chatSweep(commandId, 2, configDir);
    lateFlush.join();

    assertEquals(2, transcriptLines(commandId).size(), "the sweep must wait for the late flush");
  }

  @Test
  public void chatSweepSweepsAnywayWhenTheFileNeverCatchesUp() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(conventionalTranscript(sessionId), List.of(line(sessionId, "only")));

    agentTranscriptService.chatSweep(commandId, 3, configDir);

    assertEquals(1, transcriptLines(commandId).size(), "exhausted retries still sweep");
  }

  @Test
  public void chatReplayFallsBackToTheOutputStreamWhenNoTranscriptExists() {
    // A pre-lineage chat has only intercepted stdout rows; the TRANSCRIPT request serves them.
    String commandId = seedCommand(List.of(pinned(UUID.randomUUID().toString())));
    commandLogService.importLines(
        List.of(
            new CommandLogService.PendingLine(
                commandId,
                0,
                LogChannel.OUTPUT,
                "{\"type\":\"user\",\"text\":\"hi\"}",
                Instant.parse("2026-07-10T08:00:00Z")),
            new CommandLogService.PendingLine(
                commandId,
                1,
                LogChannel.OUTPUT,
                "{\"type\":\"assistant\"}",
                Instant.parse("2026-07-10T08:00:01Z"))));

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(2, lines.size());
    assertTrue(lines.get(0).content().contains("\"hi\""));
  }

  @Test
  public void chatReplayMergesOnlyErrorResultsFromTheOutputChannel() throws IOException {
    // A lineage-era chat persisted its FULL stream on OUTPUT; only the error result (which the
    // transcript lacks) may merge in — anything more would double-render the conversation.
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedCommand(List.of(pinned(sessionId)));
    Files.write(
        conventionalTranscript(sessionId),
        List.of(userLine(sessionId, "question"), line(sessionId, "answer")));
    agentTranscriptService.sweep(commandId, configDir);
    commandLogService.importLines(
        List.of(
            new CommandLogService.PendingLine(
                commandId,
                0,
                LogChannel.OUTPUT,
                "{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"boom\"}",
                Instant.parse("2026-07-10T07:59:30Z")),
            new CommandLogService.PendingLine(
                commandId,
                1,
                LogChannel.OUTPUT,
                "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"dup\"}]}}",
                Instant.parse("2026-07-10T07:59:40Z"))));

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(3, lines.size(), "transcript + the one error result, nothing else");
    // userLine carries 07:59:00, the error 07:59:30, line() 08:00:00 — merged by timestamp.
    assertTrue(lines.get(0).content().contains("question"));
    assertTrue(lines.get(1).content().contains("\"boom\""));
    assertTrue(lines.get(2).content().contains("answer"));
  }

  @Test
  public void aTerminalCommandsTranscriptViewNeverFallsBackToPtyOutput() {
    String commandId =
        seedCommand(List.of(pinned(UUID.randomUUID().toString())), CommandKind.TERMINAL);
    commandLogService.importLines(
        List.of(
            new CommandLogService.PendingLine(
                commandId, 0, LogChannel.OUTPUT, "[2Jraw pty bytes", Instant.now())));

    assertEquals(0, transcriptLines(commandId).size(), "no transcript means an empty view");
  }

  @Test
  public void aLaterResumeSweepSupersedesTheEarlierImportsStats() throws IOException {
    // Resume-in-place appends to the same JSONL, so the resuming command's sweep re-imports the
    // whole session — its stat row replaces the original command's rather than duplicating it.
    String sessionId = UUID.randomUUID().toString();
    String original = seedCommand(List.of(pinned(sessionId)));
    Files.write(conventionalTranscript(sessionId), List.of(line(sessionId, "one")));
    agentTranscriptService.sweep(original, configDir);

    String resumed =
        seedCommand(
            List.of(
                new AgentSessionRef(
                    sessionId, AgentSessionSource.RESUMED, null, null, Instant.now())));
    Files.write(
        conventionalTranscript(sessionId), List.of(line(sessionId, "one"), line(sessionId, "two")));
    agentTranscriptService.sweep(resumed, configDir);

    List<AgentSessionStat> stats = statRepository.findBySessionIds(List.of(sessionId));
    assertEquals(1, stats.size());
    assertEquals(2, stats.get(0).messageCount);
    assertEquals(resumed, stats.get(0).commandId);
  }
}
