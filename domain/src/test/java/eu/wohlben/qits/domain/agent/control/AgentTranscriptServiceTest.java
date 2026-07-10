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

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @TempDir Path configDir;

  /** Seeds a finished agent command whose session list is exactly {@code refs}. */
  @Transactional
  String seedCommand(List<AgentSessionRef> refs) {
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
            .kind(CommandKind.CHAT)
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
}
