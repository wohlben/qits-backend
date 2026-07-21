package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.agent.entity.AgentSessionStat;
import eu.wohlben.qits.domain.agent.persistence.AgentSessionStatRepository;
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
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Exercises Kimi {@code wire.jsonl} transcript import. */
@QuarkusTest
@TestProfile(AgentTranscriptServiceKimiTest.KimiProfile.class)
public class AgentTranscriptServiceKimiTest {

  public static class KimiProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of("qits.agent.type", "kimi");
    }
  }

  @Inject AgentTranscriptService agentTranscriptService;

  @Inject CommandService commandService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @Inject AgentSessionStatRepository statRepository;

  @TempDir Path configDir;

  private static final String KIMI_SESSION = "session_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  @Transactional
  String seedCommand(List<AgentSessionRef> refs) {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Kimi transcript project";
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
            .executeScript("exec kimi")
            .interactive(false)
            .kind(CommandKind.TERMINAL)
            .status(CommandStatus.EXITED)
            .build();
    command.agentSessions.addAll(refs);
    commandRepository.persist(command);
    return command.id;
  }

  private static AgentSessionRef pinned(String sessionId) {
    return new AgentSessionRef(sessionId, AgentSessionSource.PINNED, null, null, Instant.now());
  }

  private Path conventionalTranscript(String sessionId) throws IOException {
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
  public void importsKimiWireJsonlFilteringNoise() throws IOException {
    String commandId = seedCommand(List.of(pinned(KIMI_SESSION)));
    Files.write(
        conventionalTranscript(KIMI_SESSION),
        List.of(
            "{\"metadata\":{\"protocol_version\":\"1.0\"}}",
            "{\"config\":{\"update\":{\"tools\":[]}}}",
            "{\"role\":\"user\",\"content\":\"hello\"}",
            "{\"role\":\"assistant\",\"content\":\"hi there\"}",
            "{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}]}",
            "{\"role\":\"tool\",\"content\":\"ok\"}",
            "{\"session\":{\"resume_hint\":\"" + KIMI_SESSION + "\"}}"));

    agentTranscriptService.sweep(commandId, configDir);

    // All non-blank wire.jsonl lines are imported raw; the stat row counts conversation turns.
    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(7, lines.size(), "all wire.jsonl lines are imported");
    assertTrue(lines.get(2).content().contains("hello"));
    assertTrue(lines.get(3).content().contains("hi there"));
    assertTrue(lines.get(4).content().contains("done"));

    List<AgentSessionStat> stats = statRepository.findBySessionIds(List.of(KIMI_SESSION));
    assertEquals(1, stats.size());
    assertEquals(3, stats.get(0).messageCount);
  }

  @Test
  public void importsKimiSubagentSidechains() throws IOException {
    String commandId = seedCommand(List.of(pinned(KIMI_SESSION)));
    Path main = conventionalTranscript(KIMI_SESSION);
    Files.write(main, List.of("{\"role\":\"user\",\"content\":\"main\"}"));
    Path sidechain =
        configDir.resolve(
            Path.of(
                "sessions",
                "wd_workspace_c52ddf65534b",
                KIMI_SESSION,
                "agents",
                "sub-1",
                "wire.jsonl"));
    Files.createDirectories(sidechain.getParent());
    Files.write(sidechain, List.of("{\"role\":\"assistant\",\"content\":\"sidechain-work\"}"));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(3, lines.size(), "main + synthetic meta + sidechain");
    assertTrue(lines.get(1).content().contains(AgentTranscriptService.AGENT_META_TYPE));
    assertTrue(lines.get(1).content().contains("\"agentId\":\"sub-1\""));
    assertTrue(lines.get(2).content().contains("sidechain-work"));
  }

  @Test
  public void reportedPathIsRemappedFromContainerMount() throws IOException {
    String commandId =
        seedCommand(
            List.of(
                new AgentSessionRef(
                    KIMI_SESSION,
                    AgentSessionSource.PINNED,
                    null,
                    "/claude-home/.kimi-code/sessions/wd_workspace_c52ddf65534b/"
                        + KIMI_SESSION
                        + "/agents/main/wire.jsonl",
                    Instant.now())));
    Path reported =
        configDir.resolve(
            Path.of(
                "sessions",
                "wd_workspace_c52ddf65534b",
                KIMI_SESSION,
                "agents",
                "main",
                "wire.jsonl"));
    Files.createDirectories(reported.getParent());
    Files.write(reported, List.of("{\"role\":\"assistant\",\"content\":\"from-hook\"}"));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size());
    assertTrue(lines.get(0).content().contains("from-hook"));
  }

  @Test
  public void configDirDerivesTheKimiCodeDotDir() {
    // The kimi home is .kimi-code, not .kimi — property interpolation can't express that mapping,
    // so the default is derived in code.
    assertEquals(Path.of("/claude-home/.kimi-code"), agentTranscriptService.configDir());
  }

  @Test
  public void driftedWorkDirKeyFallsBackToSessionDirLookup() throws IOException {
    String commandId = seedCommand(List.of(pinned(KIMI_SESSION)));
    // The transcript sits under a workDirKey the escaping convention wouldn't produce — the
    // recovery lookup finds the session dir by name under sessions/.
    Path drifted =
        configDir.resolve(
            Path.of("sessions", "unexpected-key", KIMI_SESSION, "agents", "main", "wire.jsonl"));
    Files.createDirectories(drifted.getParent());
    Files.write(drifted, List.of("{\"role\":\"user\",\"content\":\"found anyway\"}"));

    agentTranscriptService.sweep(commandId, configDir);

    List<CommandLogLineDto> lines = transcriptLines(commandId);
    assertEquals(1, lines.size());
    assertTrue(lines.get(0).content().contains("found anyway"));
  }
}
