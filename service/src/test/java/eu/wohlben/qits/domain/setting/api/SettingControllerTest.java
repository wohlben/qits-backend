package eu.wohlben.qits.domain.setting.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class SettingControllerTest {

  @Test
  public void putThenGetRoundTripsAValue() {
    String key = "test.controller-round-trip";
    given()
        .contentType(ContentType.JSON)
        .body(new SettingController.UpdateSettingRequest("hello"))
        .when()
        .put("/api/settings/" + key)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("setting.key", equalTo(key))
        .body("setting.value", equalTo("hello"));

    given()
        .when()
        .get("/api/settings/" + key)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("setting.value", equalTo("hello"));
  }

  @Test
  public void listIncludesTheSeededDefaultAgentSetting() {
    given()
        .when()
        .get("/api/settings")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.find { it.setting.key == 'agent.default-type' }.setting", notNullValue());
  }

  @Test
  public void getUnknownKeyIs404() {
    given()
        .when()
        .get("/api/settings/test.does-not-exist")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void putUnknownAgentTypeIsRejected() {
    given()
        .contentType(ContentType.JSON)
        .body(new SettingController.UpdateSettingRequest("gpt"))
        .when()
        .put("/api/settings/agent.default-type")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }
}
