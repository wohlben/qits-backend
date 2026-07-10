package eu.wohlben.qits.domain.agent.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import eu.wohlben.qits.domain.agent.entity.AgentSessionStat;
import eu.wohlben.qits.domain.agent.persistence.AgentSessionStatRepository;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
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
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The workspace agent-sessions read endpoint: resumes collapse onto one node, forks nest under
 * their origin, sweep-aggregated stats attach as counts and subagent rows, and sessions of other
 * workspaces stay invisible.
 */
@QuarkusTest
public class AgentSessionControllerTest {

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @Inject AgentSessionStatRepository statRepository;

  private record Seed(String repoId, Workspace workspace) {}

  @Transactional
  Seed seedWorkspace() {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Sessions project";
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
    return new Seed(repository.id, workspace);
  }

  @Transactional
  String seedCommand(Seed seed, CommandStatus status, List<AgentSessionRef> refs) {
    Command command =
        Command.builder()
            .id(UUID.randomUUID().toString())
            .workspace(seed.workspace())
            .branch("feature/x")
            .commitHash("abcdef1234567890")
            .actionName("Claude Code (repository MCP)")
            .executeScript("exec claude")
            .interactive(false)
            .kind(CommandKind.TERMINAL)
            .status(status)
            .build();
    command.agentSessions.addAll(refs);
    commandRepository.persist(command);
    return command.id;
  }

  @Transactional
  void seedStat(String commandId, String sessionId, String agentId, int messageCount) {
    statRepository.persist(
        AgentSessionStat.builder()
            .id(UUID.randomUUID().toString())
            .commandId(commandId)
            .sessionId(sessionId)
            .agentId(agentId)
            .agentType(agentId == null ? null : "Explore")
            .description(agentId == null ? null : "scan the tests")
            .messageCount(messageCount)
            .firstTimestamp(Instant.parse("2026-07-10T08:00:00Z"))
            .build());
  }

  private static AgentSessionRef ref(
      String sessionId, AgentSessionSource source, String forkedFrom) {
    return new AgentSessionRef(sessionId, source, forkedFrom, null, Instant.now());
  }

  private String sessionsPath(Seed seed) {
    return "/api/repositories/"
        + seed.repoId()
        + "/workspaces/"
        + seed.workspace().workspaceId
        + "/agent-sessions";
  }

  @Test
  public void resumesCollapseOntoOneNodePointingAtTheNewestCommand() {
    Seed seed = seedWorkspace();
    String sessionId = UUID.randomUUID().toString();
    seedCommand(
        seed, CommandStatus.EXITED, List.of(ref(sessionId, AgentSessionSource.PINNED, null)));
    String resumingCommand =
        seedCommand(
            seed, CommandStatus.EXITED, List.of(ref(sessionId, AgentSessionSource.RESUMED, null)));

    given()
        .when()
        .get(sessionsPath(seed))
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("sessions", hasSize(1))
        .body("sessions[0].sessionId", equalTo(sessionId))
        .body("sessions[0].newestCommandId", equalTo(resumingCommand));
  }

  @Test
  public void forksNestUnderTheirOriginSession() {
    Seed seed = seedWorkspace();
    String original = UUID.randomUUID().toString();
    String fork = UUID.randomUUID().toString();
    seedCommand(
        seed, CommandStatus.EXITED, List.of(ref(original, AgentSessionSource.PINNED, null)));
    seedCommand(
        seed, CommandStatus.EXITED, List.of(ref(fork, AgentSessionSource.FORKED, original)));

    given()
        .when()
        .get(sessionsPath(seed))
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("sessions", hasSize(1))
        .body("sessions[0].sessionId", equalTo(original))
        .body("sessions[0].children", hasSize(1))
        .body("sessions[0].children[0].sessionId", equalTo(fork))
        .body("sessions[0].children[0].forkedFromSessionId", equalTo(original));
  }

  @Test
  public void statsAttachAsMessageCountAndSubagentRows() {
    Seed seed = seedWorkspace();
    String sessionId = UUID.randomUUID().toString();
    String commandId =
        seedCommand(
            seed, CommandStatus.EXITED, List.of(ref(sessionId, AgentSessionSource.PINNED, null)));
    seedStat(commandId, sessionId, null, 7);
    seedStat(commandId, sessionId, "a1b2", 3);

    given()
        .when()
        .get(sessionsPath(seed))
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("sessions[0].messageCount", equalTo(7))
        .body("sessions[0].subagents", hasSize(1))
        .body("sessions[0].subagents[0].agentId", equalTo("a1b2"))
        .body("sessions[0].subagents[0].agentType", equalTo("Explore"))
        .body("sessions[0].subagents[0].description", equalTo("scan the tests"))
        .body("sessions[0].subagents[0].messageCount", equalTo(3));
  }

  @Test
  public void aNeverSweptSessionAppearsWithoutCounts() {
    Seed seed = seedWorkspace();
    String sessionId = UUID.randomUUID().toString();
    seedCommand(
        seed, CommandStatus.RUNNING, List.of(ref(sessionId, AgentSessionSource.PINNED, null)));

    given()
        .when()
        .get(sessionsPath(seed))
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("sessions", hasSize(1))
        .body("sessions[0].sessionId", equalTo(sessionId))
        .body("sessions[0].messageCount", nullValue());
  }

  @Test
  public void otherWorkspacesSessionsAreAbsent() {
    Seed seed = seedWorkspace();
    Seed other = seedWorkspace();
    seedCommand(
        seed,
        CommandStatus.EXITED,
        List.of(ref(UUID.randomUUID().toString(), AgentSessionSource.PINNED, null)));
    seedCommand(
        other,
        CommandStatus.EXITED,
        List.of(ref(UUID.randomUUID().toString(), AgentSessionSource.PINNED, null)));

    given()
        .when()
        .get(sessionsPath(seed))
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("sessions", hasSize(1));
  }

  @Test
  public void anUnknownWorkspaceIs404() {
    Seed seed = seedWorkspace();

    given()
        .when()
        .get("/api/repositories/" + seed.repoId() + "/workspaces/nope/agent-sessions")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
