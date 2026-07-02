package eu.wohlben.qits.domain.speech.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Validation-level tests only — every request fails before the transcription runner could spawn, so
 * the suite never needs python or the parakeet model.
 */
@QuarkusTest
public class SpeechControllerTest {

  @Test
  public void missingAudioIsRejected() {
    Map<String, Object> body = new HashMap<>();
    body.put("audioBase64", null);
    given()
        .contentType(ContentType.JSON)
        .body(body)
        .when()
        .post("/api/speech/transcriptions")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void invalidBase64IsRejected() {
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("audioBase64", "!!! not base64 !!!"))
        .when()
        .post("/api/speech/transcriptions")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }
}
