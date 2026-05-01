package eu.wohlben.qits.openapi;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static io.restassured.RestAssured.given;

@QuarkusTest
public class OpenApiSchemaExportTest {

    @Test
    public void exportOpenApiSchema() throws Exception {
        String schema = given()
            .when()
            .get("/q/openapi")
            .then()
            .statusCode(200)
            .extract()
            .asString();

        Path docsDir = Paths.get("../docs");
        if (!Files.exists(docsDir)) {
            Files.createDirectories(docsDir);
        }

        Path target = docsDir.resolve("openapi.yml");
        Files.writeString(target, schema);
    }
}
