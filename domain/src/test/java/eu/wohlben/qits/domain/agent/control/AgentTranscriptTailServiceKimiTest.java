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
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The live tail must normalize Kimi {@code wire.jsonl} into the shared event envelope exactly as
 * the exit sweep does — otherwise a re-attach to a <em>running</em> Kimi chat serves raw wire lines
 * the frontend can't render and which never stitch to the live ring.
 */
@QuarkusTest
@TestProfile(AgentTranscriptTailServiceKimiTest.KimiProfile.class)
public class AgentTranscriptTailServiceKimiTest {

  public static class KimiProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of("qits.agent.type", "kimi");
    }
  }

  private static final String KIMI_SESSION = "session_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  @Inject AgentTranscriptTailService tailService;
  @Inject CommandService commandService;
  @Inject ProjectRepository projectRepository;
  @Inject RepositoryRepository repositoryRepository;
  @Inject WorkspaceRepository workspaceRepository;
  @Inject CommandRepository commandRepository;

  @TempDir Path configDir;

  @Transactional
  String seedChat(String sessionId) {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Kimi tail project";
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
            .actionName("Kimi Code (repository MCP)")
            .executeScript("exec kimi acp")
            .interactive(false)
            .kind(CommandKind.CHAT)
            .status(CommandStatus.RUNNING)
            .build();
    command.agentSessions.add(
        new AgentSessionRef(sessionId, AgentSessionSource.PINNED, null, null, Instant.now()));
    commandRepository.persist(command);
    return command.id;
  }

  private Path wireFile(String sessionId) throws IOException {
    Path file =
        configDir.resolve(
            Path.of(
                "sessions",
                "wd_workspace_c52ddf65534b",
                sessionId,
                "agents",
                "main",
                "wire.jsonl"));
    Files.createDirectories(file.getParent());
    return file;
  }

  private List<CommandLogLineDto> transcriptLines(String commandId) {
    return commandService.log(commandId, null, LogChannel.TRANSCRIPT);
  }

  @Test
  public void tailNormalizesKimiWireLinesAndCountsRawLinesForTheHighWater() throws IOException {
    String commandId = seedChat(KIMI_SESSION);
    Path file = wireFile(KIMI_SESSION);
    // One noise line (dropped), then two message lines (normalized to envelopes).
    Files.write(file, List.of("{\"metadata\":{\"protocol_version\":\"1.0\"}}", wireUser("hi")));

    tailService.startTail(commandId, configDir);
    tailService.pollNow(commandId);
    Files.write(file, List.of(wireAssistant("yo")), StandardOpenOption.APPEND);
    tailService.pollNow(commandId);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(2, lines.size(), "noise dropped; user+assistant normalized: " + lines);
    assertTrue(lines.get(0).content().contains("\"type\":\"user\""), lines.get(0).content());
    assertTrue(lines.get(0).content().contains("hi"), lines.get(0).content());
    assertTrue(lines.get(0).content().contains("\"uuid\""), lines.get(0).content());
    assertTrue(lines.get(0).content().contains(KIMI_SESSION), lines.get(0).content());
    assertTrue(lines.get(1).content().contains("\"type\":\"assistant\""), lines.get(1).content());
    assertTrue(lines.get(1).content().contains("yo"), lines.get(1).content());
    // The high-water counts raw wire lines consumed (incl. the dropped noise line), so the exit
    // sweep's settle compares like-for-like against the raw file.
    assertEquals(3, tailService.stopAndDrain(commandId), "3 raw lines consumed");
  }

  private static String wireUser(String text) {
    return "{\"role\":\"user\",\"content\":\"" + text + "\"}";
  }

  private static String wireAssistant(String text) {
    return "{\"role\":\"assistant\",\"content\":\"" + text + "\"}";
  }
}
