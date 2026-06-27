package eu.wohlben.qits.cli;

import io.quarkus.runtime.Quarkus;
import io.quarkus.runtime.QuarkusApplication;
import io.quarkus.runtime.annotations.QuarkusMain;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

/**
 * Application entry point. With no recognised command it runs as the normal web server (dev and the
 * packaged app); given a command argument it runs that as a one-shot CLI (Quarkus "command mode")
 * and exits — reusing the same beans, so commands stay in sync with the domain.
 *
 * <p>Build once (Quinoa off — the seeder needs no UI), then run the {@code seed} command from the
 * {@code service} dir so its H2 file path matches {@code quarkus:dev}'s:
 *
 * <pre>
 *   ./mvnw -pl service package -DskipTests -Dquarkus.quinoa.enabled=false
 *   (cd service &amp;&amp; java -jar target/quarkus-app/quarkus-run.jar seed)
 * </pre>
 *
 * <p>To seed while a dev server is running, add {@code -Dquarkus.http.port=0} before {@code -jar}:
 * an ephemeral HTTP port avoids the clash, and H2's {@code AUTO_SERVER} lets both processes share
 * the file DB.
 */
@QuarkusMain
public class Main {

  public static void main(String... args) {
    Quarkus.run(QitsApplication.class, args);
  }

  public static class QitsApplication implements QuarkusApplication {

    private static final Logger LOG = Logger.getLogger(QitsApplication.class);

    @Inject SeedService seedService;

    @Override
    public int run(String... args) {
      String command = args.length > 0 ? args[0] : "";
      switch (command) {
        case "seed":
          seedService.seed();
          return 0;
        case "":
          // No command — run as the normal long-running server.
          Quarkus.waitForExit();
          return 0;
        default:
          LOG.errorf("Unknown command '%s'. Known commands: seed.", command);
          return 1;
      }
    }
  }
}
