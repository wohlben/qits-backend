package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/**
 * With {@code qits.workspace.watch.enabled=false} (the test default), a {@code
 * WorkspaceContainerStarted} spawns no watcher — the whole subsystem is dark.
 */
@QuarkusTest
public class WorkspaceWatchKillSwitchTest {

  @Inject WorkspaceWatchService watchService;
  @Inject WorkspaceContainerEventPublisher containerEvents;

  @Test
  public void disabledWatcherIgnoresContainerStarted() throws Exception {
    containerEvents.fireStarted("repo-x", "wt-x");
    // Give the async observer a chance to (not) act before asserting nothing started.
    Thread.sleep(500);
    assertEquals(
        0, watchService.activeWatchCount(), "no watcher starts while the kill switch is off");
  }
}
