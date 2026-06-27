package eu.wohlben.qits.cli;

import io.quarkus.runtime.Quarkus;
import io.quarkus.runtime.QuarkusApplication;
import io.quarkus.runtime.annotations.QuarkusMain;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

/**
 * Entry point for the {@code cli} module — a Quarkus "command-mode" app that runs a command and
 * exits. It depends on {@code domain} but not on the web stack, so it boots with no HTTP server. It
 * reuses the same beans as the service, so commands stay in sync with the domain.
 *
 * <p>Run a command in one step (the cli pom binds {@code quarkus:run}'s program arguments to the
 * {@code cli.args} property). It shares the service's H2 file via a fixed {@code
 * ${user.home}/.qits} location, so data it writes shows up in the running app:
 *
 * <pre>
 *   ./mvnw -pl cli quarkus:run -Dcli.args=seed
 * </pre>
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
        default:
          LOG.errorf("Usage: <command>. Known commands: seed. (got: '%s')", command);
          return 1;
      }
    }
  }
}
