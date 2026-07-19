package eu.wohlben.qits.domain.repository.control;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.ObservesAsync;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Test helper: records every {@link WorkspaceReadyForDaemons} the async event bus delivers, so
 * tests can assert whether (and when) the bootstrap runner released daemon auto-start.
 */
@ApplicationScoped
public class WorkspaceReadyForDaemonsRecorder {

  private final List<WorkspaceReadyForDaemons> events = new CopyOnWriteArrayList<>();

  void onReady(@ObservesAsync WorkspaceReadyForDaemons evt) {
    events.add(evt);
  }

  public List<WorkspaceReadyForDaemons> events() {
    return List.copyOf(events);
  }

  public long countFor(String repoId, String workspaceId) {
    return events.stream()
        .filter(e -> e.repoId().equals(repoId) && e.workspaceId().equals(workspaceId))
        .count();
  }

  public void clear() {
    events.clear();
  }
}
