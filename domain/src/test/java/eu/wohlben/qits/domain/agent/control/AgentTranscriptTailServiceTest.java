package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Exercises the live transcript tail against a temp-dir "config dir" shaped like the real claude
 * volume. Polls are driven synchronously via {@code pollNow} (the scheduled cadence is parked at an
 * hour in the test profile), so every assertion is deterministic.
 */
@QuarkusTest
public class AgentTranscriptTailServiceTest {

  @Inject AgentTranscriptTailService tailService;

  @Inject CommandService commandService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @TempDir Path configDir;

  /** Seeds a running chat command pinned to {@code sessionId}. */
  @Transactional
  String seedChat(String sessionId) {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Tail project";
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
            .kind(CommandKind.CHAT)
            .status(CommandStatus.RUNNING)
            .build();
    command.agentSessions.add(
        new AgentSessionRef(sessionId, AgentSessionSource.PINNED, null, null, Instant.now()));
    commandRepository.persist(command);
    return command.id;
  }

  private static String line(String text) {
    return "{\"parentUuid\":null,\"sessionId\":\"s1\",\"isSidechain\":false,"
        + "\"timestamp\":\"2026-07-10T08:00:00.000Z\",\"type\":\"assistant\","
        + "\"message\":{\"content\":[{\"type\":\"text\",\"text\":\""
        + text
        + "\"}]}}";
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
  public void theFileMayAppearAfterTheTailStarts() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);
    assertEquals(0, transcriptLines(commandId).size(), "nothing to import before the file exists");

    Files.write(conventionalTranscript(sessionId), List.of(line("first")));
    tailService.pollNow(commandId);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size());
    assertTrue(lines.get(0).content().contains("first"));

    tailService.stopAndDrain(commandId);
  }

  @Test
  public void appendsIncrementallyAcrossPollsWithContinuousSequences() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);
    Path file = conventionalTranscript(sessionId);
    Files.write(file, List.of(line("one")));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);
    Files.write(file, List.of(line("two")), StandardOpenOption.APPEND);
    tailService.pollNow(commandId);
    tailService.pollNow(commandId); // an idle poll must not re-import.

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(2, lines.size());
    assertTrue(lines.get(0).content().contains("one"));
    assertTrue(lines.get(1).content().contains("two"));
    assertEquals(AgentTranscriptService.TRANSCRIPT_SEQ_BASE, lines.get(0).sequence());
    assertEquals(AgentTranscriptService.TRANSCRIPT_SEQ_BASE + 1, lines.get(1).sequence());
    // The line's own timestamp field wins over the import time.
    assertEquals(Instant.parse("2026-07-10T08:00:00.000Z"), lines.get(0).timestamp());

    tailService.stopAndDrain(commandId);
  }

  @Test
  public void aPartialLineIsBufferedUntilItsNewlineArrives() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);
    Path file = conventionalTranscript(sessionId);
    String full = line("split-across-polls");
    Files.writeString(file, full.substring(0, 30));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);
    assertEquals(0, transcriptLines(commandId).size(), "an unterminated line must not import");

    Files.writeString(file, full.substring(30) + "\n", StandardOpenOption.APPEND);
    tailService.pollNow(commandId);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size());
    assertEquals(full, lines.get(0).content(), "the two fragments must frame into one raw line");

    tailService.stopAndDrain(commandId);
  }

  @Test
  public void aResumedSessionsExistingFileImportsFromTheTop() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);
    Files.write(conventionalTranscript(sessionId), List.of(line("history-1"), line("history-2")));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(2, lines.size(), "prior history is part of the durable head");
    assertTrue(lines.get(0).content().contains("history-1"));

    tailService.stopAndDrain(commandId);
  }

  @Test
  public void aLineBeyondTheOldTruncationCapImportsAsOneRow() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);
    String big = line("z".repeat(100_000));
    Files.write(conventionalTranscript(sessionId), List.of(big));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size(), "no force-framing: one JSON event stays one row");
    assertEquals(big, lines.get(0).content());

    tailService.stopAndDrain(commandId);
  }

  @Test
  public void stopAndDrainPicksUpLastLinesAndReturnsTheHighWater() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);
    Path file = conventionalTranscript(sessionId);
    Files.write(file, List.of(line("one")));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);
    Files.write(file, List.of(line("two")), StandardOpenOption.APPEND);

    assertEquals(2, tailService.stopAndDrain(commandId), "the final drain counts");
    assertEquals(2, transcriptLines(commandId).size());
    assertEquals(0, tailService.stopAndDrain(commandId), "stopping twice is a no-op");
  }

  @Test
  public void truncationReseedsTheChannel() throws IOException {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedChat(sessionId);
    Path file = conventionalTranscript(sessionId);
    Files.write(file, List.of(line("one"), line("two")));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);
    assertEquals(2, transcriptLines(commandId).size());

    Files.write(file, List.of(line("rewritten")), StandardOpenOption.TRUNCATE_EXISTING);
    tailService.pollNow(commandId);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size(), "the channel converges to the file's new content");
    assertTrue(lines.get(0).content().contains("rewritten"));
    assertEquals(AgentTranscriptService.TRANSCRIPT_SEQ_BASE, lines.get(0).sequence());

    tailService.stopAndDrain(commandId);
  }
}
