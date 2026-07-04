package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.persistence.DaemonConfigurationRepository;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;
import org.jboss.logging.Logger;

/**
 * Seeds one demo global daemon on startup (idempotent by name, mirroring {@code
 * ActionConfigurationSeeder}): a Python static file server with a ready pattern and both observer
 * kinds attached — enough to watch the whole lifecycle without any project-specific setup.
 */
@ApplicationScoped
public class DaemonSeeder {

  private static final Logger LOG = Logger.getLogger(DaemonSeeder.class);

  private static final String HTTP_SERVER_NAME = "Python HTTP server";

  @Inject DaemonConfigurationRepository daemonConfigurationRepository;

  @Inject DaemonConfigurationService daemonConfigurationService;

  @Transactional
  void seedDefaults(@Observes StartupEvent event) {
    if (daemonConfigurationRepository.findByName(HTTP_SERVER_NAME).isPresent()) {
      return;
    }
    daemonConfigurationService.create(
        HTTP_SERVER_NAME,
        "Serves the worktree over HTTP on :8000 — a demo daemon for the supervisor",
        "python3 -m http.server 8000",
        "Serving HTTP",
        "TERM",
        RestartPolicy.ON_FAILURE,
        3,
        null,
        List.of(
            new LogObserver(
                LogObserverKind.PATTERN, "Traceback|Exception", DaemonEventSeverity.ERROR, null),
            new LogObserver(LogObserverKind.MODEL, null, null, null)));
    LOG.infof("Seeded global daemon '%s'", HTTP_SERVER_NAME);
  }
}
