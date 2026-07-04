package eu.wohlben.qits.domain.daemon.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;

import eu.wohlben.qits.domain.daemon.api.DaemonConfigurationController.CreateDaemonConfigurationRequest;
import eu.wohlben.qits.domain.daemon.api.DaemonConfigurationController.UpdateDaemonConfigurationRequest;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** CRUD round-trip over the global daemon library, mirroring the action-configuration surface. */
@QuarkusTest
public class DaemonConfigurationControllerTest {

  private String create(String name) {
    return given()
        .contentType(ContentType.JSON)
        .body(
            new CreateDaemonConfigurationRequest(
                name,
                "a dev server",
                "npm run dev",
                "Listening on.*:3000",
                "SIGINT",
                RestartPolicy.ALWAYS,
                5,
                Map.of("PORT", "3000"),
                List.of(
                    new LogObserverInput(
                        LogObserverKind.PATTERN, "ERROR", DaemonEventSeverity.ERROR),
                    new LogObserverInput(LogObserverKind.LOG_LEVEL, null, null)),
                List.of(new LogSourceInput("logs/app.log", "app log"))))
        .post("/api/daemon-configurations")
        .then()
        .statusCode(200)
        .body("daemonConfiguration.name", equalTo(name))
        .body("daemonConfiguration.startScript", equalTo("npm run dev"))
        .body("daemonConfiguration.readyPattern", equalTo("Listening on.*:3000"))
        .body("daemonConfiguration.stopSignal", equalTo("INT"))
        .body("daemonConfiguration.restartPolicy", equalTo("ALWAYS"))
        .body("daemonConfiguration.maxRestarts", equalTo(5))
        .body("daemonConfiguration.scope", equalTo("GLOBAL"))
        .body("daemonConfiguration.environment.PORT", equalTo("3000"))
        .body("daemonConfiguration.observers[0].kind", equalTo("PATTERN"))
        .body("daemonConfiguration.observers[0].pattern", equalTo("ERROR"))
        .body("daemonConfiguration.observers[1].kind", equalTo("LOG_LEVEL"))
        .body("daemonConfiguration.sources[0].path", equalTo("logs/app.log"))
        .body("daemonConfiguration.sources[0].label", equalTo("app log"))
        .extract()
        .path("daemonConfiguration.id");
  }

  @Test
  public void crudRoundTrip() {
    String id = create("Dev server (crud)");

    given()
        .get("/api/daemon-configurations/" + id)
        .then()
        .statusCode(200)
        .body("daemonConfiguration.id", equalTo(id))
        .body("daemonConfiguration.observers.size()", equalTo(2));

    given()
        .get("/api/daemon-configurations")
        .then()
        .statusCode(200)
        .body("entries.daemonConfiguration.id", hasItem(id));

    given()
        .contentType(ContentType.JSON)
        .body(
            new UpdateDaemonConfigurationRequest(
                "Dev server (renamed)",
                null,
                null,
                "",
                null,
                RestartPolicy.NEVER,
                null,
                null,
                List.of(
                    new LogObserverInput(
                        LogObserverKind.PATTERN, "FATAL", DaemonEventSeverity.WARNING)),
                null))
        .put("/api/daemon-configurations/" + id)
        .then()
        .statusCode(200)
        .body("daemonConfiguration.name", equalTo("Dev server (renamed)"))
        .body("daemonConfiguration.startScript", equalTo("npm run dev"))
        .body("daemonConfiguration.readyPattern", equalTo(null))
        .body("daemonConfiguration.restartPolicy", equalTo("NEVER"))
        .body("daemonConfiguration.observers.size()", equalTo(1))
        .body("daemonConfiguration.observers[0].pattern", equalTo("FATAL"))
        .body(
            "daemonConfiguration.sources[0].path",
            equalTo("logs/app.log")); // null sources on update means "keep as-is"

    given()
        .delete("/api/daemon-configurations/" + id)
        .then()
        .statusCode(200)
        .body("success", equalTo(true));

    given().get("/api/daemon-configurations/" + id).then().statusCode(404);
  }

  @Test
  public void rejectsAnInvalidReadyPatternRegex() {
    given()
        .contentType(ContentType.JSON)
        .body(
            new CreateDaemonConfigurationRequest(
                "Broken regex",
                null,
                "npm run dev",
                "([unclosed",
                null,
                null,
                null,
                null,
                null,
                null))
        .post("/api/daemon-configurations")
        .then()
        .statusCode(400);
  }

  @Test
  public void rejectsAPatternObserverWithoutAPattern() {
    given()
        .contentType(ContentType.JSON)
        .body(
            new CreateDaemonConfigurationRequest(
                "Observer without pattern",
                null,
                "npm run dev",
                null,
                null,
                null,
                null,
                null,
                List.of(new LogObserverInput(LogObserverKind.PATTERN, null, null)),
                null))
        .post("/api/daemon-configurations")
        .then()
        .statusCode(400);
  }

  @Test
  public void rejectsTraversalInLogSourcePaths() {
    for (String path : List.of("../outside.log", "/etc/passwd", ".git/config")) {
      given()
          .contentType(ContentType.JSON)
          .body(
              new CreateDaemonConfigurationRequest(
                  "Bad source",
                  null,
                  "npm run dev",
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  List.of(new LogSourceInput(path, null))))
          .post("/api/daemon-configurations")
          .then()
          .statusCode(400);
    }
  }

  @Test
  public void validatesRequiredFields() {
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("name", "no script"))
        .post("/api/daemon-configurations")
        .then()
        .statusCode(400);
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("name", "x", "startScript", "run", "observers", List.of(Map.of())))
        .post("/api/daemon-configurations")
        .then()
        .statusCode(400);
  }

  @Test
  public void seededDemonstrationDaemonIsPresent() {
    given()
        .get("/api/daemon-configurations")
        .then()
        .statusCode(200)
        .body("entries.daemonConfiguration.name", hasItem("Python HTTP server"))
        .body(
            "entries.find { it.daemonConfiguration.name == 'Python HTTP server' }", notNullValue());
  }
}
