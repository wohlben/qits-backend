package eu.wohlben.qits.domain.featureflow.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import eu.wohlben.qits.domain.project.api.ProjectController;
import eu.wohlben.qits.domain.repository.api.WorkspaceController;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.control.WorkspaceConfigView;
import eu.wohlben.qits.workspacedaemonhost.WorkspaceDaemonRegistry;
import io.quarkus.test.InjectMock;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

/**
 * The workspace actions surface (Part 5): GET lists the union of the code-based global actions
 * ({@code CODE}, always runnable) and the workspace's config-declared actions ({@code CONFIG},
 * runnable only when non-interactive); POST runs a config action over the control socket ({@code
 * bash -lc <execute>} in {@code /workspace}), with 409 when no daemon is live, 404 for an id the
 * config doesn't declare, and 400 for an interactive config action. The daemon side is an
 * {@code @InjectMock}ed {@link WorkspaceDaemonRegistry} — the socket round-trip itself is covered
 * by {@code DaemonControlSocketTest}.
 */
@QuarkusTest
public class WorkspaceActionsControllerTest {

  private static final String WORKSPACE_ID = "work";

  @InjectMock WorkspaceDaemonRegistry daemonRegistry;

  private final String fixtureUrl;

  public WorkspaceActionsControllerTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  private String repoWithWorkspace() {
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(new ProjectController.CreateProjectRequest("WS Actions Project", null))
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");
    String repoId =
        given()
            .contentType(ContentType.JSON)
            .body(new ProjectController.CreateProjectRepositoryRequest(fixtureUrl, null, null))
            .post("/api/projects/" + projectId + "/repositories")
            .then()
            .statusCode(200)
            .extract()
            .path("repository.id");
    given()
        .contentType(ContentType.JSON)
        .body(new WorkspaceController.CreateWorkspaceRequest("work", "master", "work", null))
        .post("/api/repositories/" + repoId + "/workspaces")
        .then()
        .statusCode(200);
    return repoId;
  }

  private String surface(String repoId) {
    return "/api/repositories/" + repoId + "/workspaces/" + WORKSPACE_ID + "/actions";
  }

  /** Stage the workspace's ConfigView as the daemon would report it over the control socket. */
  private void stageConfig(QitsConfig.ActionDecl... actions) {
    when(daemonRegistry.readConfig(WORKSPACE_ID))
        .thenReturn(
            Optional.of(
                new WorkspaceConfigView(
                    new QitsConfig(null, null, List.of(actions), null, null), null)));
  }

  private void createGlobalAction(String name) {
    given()
        .contentType(ContentType.JSON)
        .body(
            new ActionConfigurationController.CreateActionConfigurationRequest(
                name, null, "echo global", null, false, null))
        .post("/api/action-configurations")
        .then()
        .statusCode(200);
  }

  @Test
  public void listsGlobalActionsAsCodeAndConfigActionsAsConfig() {
    String repoId = repoWithWorkspace();
    createGlobalAction("Global Build XYZ");
    stageConfig(
        new QitsConfig.ActionDecl(
            null, "cfg-test", "runs the tests", "echo t", null, false, Map.of("CI", "true")),
        new QitsConfig.ActionDecl(null, "cfg-shell", null, "exec bash", null, true, null));

    given()
        .get(surface(repoId))
        .then()
        .statusCode(200)
        .body("actions.find { it.name == 'Global Build XYZ' }.origin", equalTo("CODE"))
        .body("actions.find { it.name == 'Global Build XYZ' }.runnable", equalTo(true))
        .body("actions.find { it.id == 'cfg-test' }.origin", equalTo("CONFIG"))
        .body("actions.find { it.id == 'cfg-test' }.description", equalTo("runs the tests"))
        .body("actions.find { it.id == 'cfg-test' }.interactive", equalTo(false))
        .body("actions.find { it.id == 'cfg-test' }.runnable", equalTo(true))
        // interactive config actions are listed but not runnable over the pipe-mode socket
        .body("actions.find { it.id == 'cfg-shell' }.origin", equalTo("CONFIG"))
        .body("actions.find { it.id == 'cfg-shell' }.interactive", equalTo(true))
        .body("actions.find { it.id == 'cfg-shell' }.runnable", equalTo(false));
  }

  @Test
  public void runsAConfigActionAndReturnsTheCommandResult() {
    String repoId = repoWithWorkspace();
    when(daemonRegistry.isDaemonLive(WORKSPACE_ID)).thenReturn(true);
    stageConfig(new QitsConfig.ActionDecl(null, "cfg-test", null, "echo t", null, false, Map.of()));
    when(daemonRegistry.runCommand(
            eq(WORKSPACE_ID), eq(List.of("bash", "-lc", "echo t")), eq("/workspace"), anyMap()))
        .thenReturn(
            CompletableFuture.completedFuture(
                new WorkspaceDaemonRegistry.CommandResult(0, "OUT\n", "ERR\n")));

    given()
        .contentType(ContentType.JSON)
        .post(surface(repoId) + "/cfg-test/run")
        .then()
        .statusCode(200)
        .body("exitCode", equalTo(0))
        .body("stdout", equalTo("OUT\n"))
        .body("stderr", equalTo("ERR\n"));
  }

  @Test
  public void runWithAnUndeclaredActionIdIs404() {
    String repoId = repoWithWorkspace();
    when(daemonRegistry.isDaemonLive(WORKSPACE_ID)).thenReturn(true);
    stageConfig(new QitsConfig.ActionDecl(null, "cfg-test", null, "echo t", null, false, null));

    given()
        .contentType(ContentType.JSON)
        .post(surface(repoId) + "/no-such/run")
        .then()
        .statusCode(404);
  }

  @Test
  public void runWithoutALiveDaemonIs409() {
    String repoId = repoWithWorkspace();
    when(daemonRegistry.isDaemonLive(WORKSPACE_ID)).thenReturn(false);

    given()
        .contentType(ContentType.JSON)
        .post(surface(repoId) + "/cfg-test/run")
        .then()
        .statusCode(409);
  }

  @Test
  public void runOfAnInteractiveConfigActionIs400() {
    String repoId = repoWithWorkspace();
    when(daemonRegistry.isDaemonLive(WORKSPACE_ID)).thenReturn(true);
    stageConfig(new QitsConfig.ActionDecl(null, "cfg-shell", null, "exec bash", null, true, null));

    given()
        .contentType(ContentType.JSON)
        .post(surface(repoId) + "/cfg-shell/run")
        .then()
        .statusCode(400);
  }
}
