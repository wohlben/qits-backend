package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Real-docker integration test for the per-workspace file watcher — a live {@code inotifywait}
 * (built by {@link WorkspaceWatchService#watchArgv}) inside an actual {@code qits/workspace}
 * container calls the change callback when the working tree changes, and stays silent for churn
 * under an excluded directory ({@code node_modules}).
 *
 * <p>Part of the <strong>extended</strong> suite (skipped by default; run with {@code ./mvnw verify
 * -Pextended}); self-skips when docker or the image is absent. Plain JUnit (not
 * {@code @QuarkusTest}) so the {@code FakeContainerRuntime} mock does not shadow the real {@link
 * DockerExecutor}. Reuses {@link WorkspaceWatchService#watchArgv} so the exact production command
 * is exercised.
 *
 * <p>Build the image first: {@code docker build -t qits/workspace docker/workspace}.
 */
@Tag("extended")
public class WorkspaceWatchIT {

  private static final String IMAGE =
      System.getProperty("qits.workspace.image", "qits/workspace:latest");
  private static final String RUNTIME =
      System.getProperty("qits.workspace.container-runtime", "docker");

  private DockerExecutor executor() {
    DockerExecutor de = new DockerExecutor();
    de.runtime = RUNTIME;
    de.containerNetwork = "network";
    WorkspaceContainerFactory factory = new WorkspaceContainerFactory();
    factory.image = IMAGE;
    factory.network = "qits-net";
    // Config-injected fields that manual wiring must seed too: TZ propagation reads timezone
    // unconditionally, and the commit-identity env is applied to every container.
    factory.timezone = java.util.Optional.empty();
    GitIdentity gitIdentity = new GitIdentity();
    gitIdentity.name = "qits";
    gitIdentity.email = "qits@local";
    factory.gitIdentity = gitIdentity;
    de.containerFactory = factory;
    de.ensureNetwork();
    return de;
  }

  private boolean dockerAndImageAvailable(DockerExecutor de) {
    try {
      Process ping = new ProcessBuilder(RUNTIME, "image", "inspect", IMAGE).start();
      return ping.waitFor() == 0;
    } catch (Exception e) {
      return false;
    }
  }

  @Test
  public void inotifyFiresOnTrackedEditsAndStaysSilentUnderExcludedDirs() throws Exception {
    DockerExecutor de = executor();
    assumeTrue(dockerAndImageAvailable(de), "docker + " + IMAGE + " required for this IT");

    String repoId = UUID.randomUUID().toString();
    String workspaceId = "it-watch";
    String container = de.containerName(workspaceId, repoId);
    de.rm(container);

    WorkspaceWatchSession session = null;
    try {
      de.run(repoId, workspaceId, "it-branch", "main");
      // Pre-create the excluded dir so its later churn tests the --exclude filter, not watch setup.
      de.exec(
          container, "/workspace", java.util.Map.of(), "mkdir", "-p", "/workspace/node_modules");

      // Build the watch argv the production service would, then stream it via the real session,
      // counting the raw change callbacks (the marker dedup/coalesce is unit-tested separately).
      WorkspaceWatchService svc = new WorkspaceWatchService();
      svc.containers = de;
      AtomicInteger changes = new AtomicInteger();
      session =
          new WorkspaceWatchSession(
              repoId, workspaceId, svc.watchArgv(container), changes::incrementAndGet);

      // Let inotifywait establish its watches before mutating the tree (avoid a startup race).
      Thread.sleep(1_500);

      de.exec(
          container, "/workspace", java.util.Map.of(), "sh", "-c", "echo hi > /workspace/new.txt");
      awaitCondition(() -> changes.get() > 0, "a change callback for the tracked edit");

      // Churn under the excluded node_modules must not add any callback.
      int before = changes.get();
      de.exec(
          container,
          "/workspace",
          java.util.Map.of(),
          "sh",
          "-c",
          "echo x > /workspace/node_modules/pkg.js");
      Thread.sleep(1_500);
      assertTrue(
          changes.get() == before, "an edit under node_modules must not fire a change callback");
    } finally {
      if (session != null) {
        session.close();
      }
      de.rm(container);
    }
  }

  private void awaitCondition(java.util.function.BooleanSupplier condition, String what)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + 10_000;
    while (System.currentTimeMillis() < deadline) {
      if (condition.getAsBoolean()) {
        return;
      }
      Thread.sleep(50);
    }
    throw new AssertionError("Timed out waiting for " + what);
  }
}
