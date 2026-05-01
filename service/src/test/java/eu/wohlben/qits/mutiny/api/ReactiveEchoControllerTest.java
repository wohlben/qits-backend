package eu.wohlben.qits.mutiny.api;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

@QuarkusTest
public class ReactiveEchoControllerTest {

    @Test
    public void testReactiveEchoGet() {
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/api/echo/reactive/hello")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("echo", equalTo("HELLO"))
            .body("length", equalTo(5));
    }

    @Test
    public void testReactiveEchoPost() {
        given()
            .contentType(ContentType.JSON)
            .body(new ReactiveEchoController.EchoRequest("world"))
        .when()
            .post("/api/echo/reactive")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("echo", equalTo("world"))
            .body("length", equalTo(5));
    }
}
