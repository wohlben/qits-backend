package eu.wohlben.qits.domain.command.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

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
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The SessionStart hook's report endpoint: first report confirms the pinned session (recording the
 * transcript path), a differing id appends a SWITCHED entry, and the guards hold — the endpoint is
 * container-reachable without auth, so unknown/finished commands and malformed ids are rejected.
 */
@QuarkusTest
public class AgentSessionReportTest {

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  /** Seeds a command with one PINNED session entry, bypassing the process registry. */
  @Transactional
  String seedAgentCommand(String sessionId, CommandStatus status) {
    return seedCommand(
        status,
        new AgentSessionRef(sessionId, AgentSessionSource.PINNED, null, null, Instant.now()));
  }

  /** Seeds a command with the given session entries (none = an unpinned fresh Kimi launch). */
  @Transactional
  String seedCommand(CommandStatus status, AgentSessionRef... refs) {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Report project";
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
            .status(status)
            .build();
    command.agentSessions.addAll(List.of(refs));
    commandRepository.persist(command);
    return command.id;
  }

  /** The hook's stdin JSON verbatim: snake_case fields plus extras the endpoint must tolerate. */
  private static Map<String, Object> report(String sessionId, String transcriptPath) {
    Map<String, Object> body = new HashMap<>();
    body.put("hook_event_name", "SessionStart");
    body.put("source", "startup");
    body.put("session_id", sessionId);
    body.put("transcript_path", transcriptPath);
    body.put("cwd", "/workspace");
    return body;
  }

  @Test
  public void firstReportConfirmsThePinnedSessionAndRecordsThePath() {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedAgentCommand(sessionId, CommandStatus.RUNNING);
    String path = "/claude-home/.claude/projects/-workspace/" + sessionId + ".jsonl";

    given()
        .contentType(ContentType.JSON)
        .body(report(sessionId, path))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.agentSessions", hasSize(1))
        .body("command.agentSessions[0].sessionId", equalTo(sessionId))
        .body("command.agentSessions[0].source", equalTo("PINNED"))
        .body("command.agentSessions[0].transcriptPath", equalTo(path));
  }

  @Test
  public void aDifferingIdAppendsASwitchedEntryAndSwitchingBackAppendsAgain() {
    String pinned = UUID.randomUUID().toString();
    String other = UUID.randomUUID().toString();
    String commandId = seedAgentCommand(pinned, CommandStatus.RUNNING);

    // The user ran /resume inside the TUI: the hook reports the newly-driven session.
    given()
        .contentType(ContentType.JSON)
        .body(report(other, "/claude-home/.claude/projects/-workspace/" + other + ".jsonl"))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.agentSessions", hasSize(2))
        .body("command.agentSessions[1].sessionId", equalTo(other))
        .body("command.agentSessions[1].source", equalTo("SWITCHED"))
        .body("command.agentSessions[1].transcriptPath", notNullValue());

    // Switching back appends again — the list is the faithful order of sessions driven,
    // duplicates included.
    given()
        .contentType(ContentType.JSON)
        .body(report(pinned, "/claude-home/.claude/projects/-workspace/" + pinned + ".jsonl"))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.agentSessions", hasSize(3))
        .body("command.agentSessions[2].sessionId", equalTo(pinned))
        .body("command.agentSessions[2].source", equalTo("SWITCHED"));
  }

  @Test
  public void anUnknownCommandIs404() {
    given()
        .contentType(ContentType.JSON)
        .body(report(UUID.randomUUID().toString(), null))
        .when()
        .post("/api/commands/" + UUID.randomUUID() + "/agent-session")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void aFinishedCommandIs400() {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedAgentCommand(sessionId, CommandStatus.EXITED);

    given()
        .contentType(ContentType.JSON)
        .body(report(sessionId, null))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void aNonUuidSessionIdIs400() {
    String commandId = seedAgentCommand(UUID.randomUUID().toString(), CommandStatus.RUNNING);

    given()
        .contentType(ContentType.JSON)
        .body(report("../../../etc/passwd", null))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void aKimiSessionIdIsAccepted() {
    String kimiSession = "session_" + UUID.randomUUID();
    String commandId = seedAgentCommand(UUID.randomUUID().toString(), CommandStatus.RUNNING);
    String path =
        "/claude-home/.kimi-code/sessions/wd_workspace_c52ddf65534b/"
            + kimiSession
            + "/agents/main/wire.jsonl";

    given()
        .contentType(ContentType.JSON)
        .body(report(kimiSession, path))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.agentSessions", hasSize(2))
        .body("command.agentSessions[1].sessionId", equalTo(kimiSession))
        .body("command.agentSessions[1].source", equalTo("SWITCHED"));
  }

  @Test
  public void aFirstReportOnAnUnpinnedCommandEstablishesAReportedSession() {
    // A fresh Kimi launch cannot pin a session id, so the command starts with an empty session
    // list and the first hook report establishes the session as REPORTED.
    String kimiSession = "session_" + UUID.randomUUID();
    String commandId = seedCommand(CommandStatus.RUNNING);
    String path =
        "/claude-home/.kimi-code/sessions/wd_workspace_c52ddf65534b/"
            + kimiSession
            + "/agents/main/wire.jsonl";

    given()
        .contentType(ContentType.JSON)
        .body(report(kimiSession, path))
        .when()
        .post("/api/commands/" + commandId + "/agent-session")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.agentSessions", hasSize(1))
        .body("command.agentSessions[0].sessionId", equalTo(kimiSession))
        .body("command.agentSessions[0].source", equalTo("REPORTED"))
        .body("command.agentSessions[0].transcriptPath", equalTo(path));
  }
}
