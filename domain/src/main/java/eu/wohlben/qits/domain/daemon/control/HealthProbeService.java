package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.dto.HealthCheckDto;
import eu.wohlben.qits.domain.daemon.dto.HealthCheckState;
import eu.wohlben.qits.domain.daemon.dto.HealthCheckStatusDto;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Runs a daemon's healthchecks: each declared check is probed on its own interval <em>inside the
 * workspace container</em> ({@code docker exec}), so {@code 127.0.0.1:<port>} is the daemon's own
 * loopback and no port publishing is needed. Results are a live gauge — the latest verdict per
 * check is cached in a {@link ProbeSet} owned by the supervisor's in-memory instance and
 * overwritten on every tick; nothing is persisted (no {@code daemon_event} rows), and health never
 * drives the daemon's lifecycle status.
 *
 * <p>Threading: probe ticks run on the supervisor's scheduler but never touch the supervisor
 * monitor — a tick blocks for up to the probe timeout on {@code docker exec}. Per-check state is
 * guarded by its {@link ProbeSet}'s own monitor instead; the supervisor only ever calls the brief
 * {@link ProbeSet#cancel()} / {@link #snapshotOrUnknown} under its monitor (lock order is strictly
 * supervisor → ProbeSet, never the reverse).
 */
@ApplicationScoped
public class HealthProbeService {

  private static final Logger LOG = Logger.getLogger(HealthProbeService.class);

  private static final String DEFAULT_EXPECT_STATUS = "2xx,3xx";

  private static final int DETAIL_MAX = 500;

  @Inject ContainerRuntime containers;

  /** Default poll cadence for checks that don't declare their own {@code intervalMs}. */
  @ConfigProperty(name = "qits.daemons.health-poll-ms", defaultValue = "5000")
  long healthPollMillis;

  /** Default per-probe timeout for checks that don't declare their own {@code timeoutMs}. */
  @ConfigProperty(name = "qits.daemons.health-timeout-ms", defaultValue = "2000")
  long healthTimeoutMillis;

  /** Kill switch: when false, no probes are scheduled and every check reads UNKNOWN. */
  @ConfigProperty(name = "qits.daemons.health-enabled", defaultValue = "true")
  boolean healthEnabled;

  /** Default first-probe grace for checks that don't declare their own {@code initialDelayMs}. */
  @ConfigProperty(name = "qits.daemons.ready-grace-ms", defaultValue = "10000")
  long readyGraceMillis;

  /**
   * Schedule every declared check of one daemon instance and return the handle holding their live
   * state. Called once per launch epoch — a relaunch/adoption builds a fresh set, so a tick that
   * outlives a stopped instance can only write into a discarded object, never the live epoch.
   *
   * @param adopt true when re-adopting an already-running session: the boot grace is irrelevant,
   *     probe immediately so the dots repopulate within one interval.
   * @param onStateFlip invoked (off any lock) whenever a check's public state changes — the
   *     supervisor uses it to fire the SSE topic hint; deliberately never called on a mere
   *     latency/detail refresh, so live clients aren't polled per tick.
   */
  public ProbeSet start(
      ScheduledExecutorService scheduler,
      String container,
      List<HealthCheckDto> checks,
      Map<String, String> env,
      boolean adopt,
      Runnable onStateFlip) {
    ProbeSet set = new ProbeSet();
    if (checks == null || checks.isEmpty()) {
      return set;
    }
    for (HealthCheckDto check : checks) {
      CheckRuntime runtime = new CheckRuntime(check);
      set.byName.put(check.name(), runtime);
      if (!healthEnabled) {
        continue;
      }
      long interval = check.intervalMs() != null ? check.intervalMs() : healthPollMillis;
      long initialDelay =
          adopt ? 0 : check.initialDelayMs() != null ? check.initialDelayMs() : readyGraceMillis;
      runtime.future =
          scheduler.scheduleWithFixedDelay(
              () -> tick(set, runtime, container, env, onStateFlip),
              initialDelay,
              interval,
              TimeUnit.MILLISECONDS);
    }
    return set;
  }

  /**
   * The live health of every <em>declared</em> check, aligned by name: checks the given set has no
   * runtime state for (never probed, stopped daemon, kill switch, renamed check) read UNKNOWN. The
   * DTO shape is therefore stable regardless of runtime state — one entry per declared check.
   */
  public static List<HealthCheckStatusDto> snapshotOrUnknown(
      ProbeSet set, List<HealthCheckDto> declared) {
    if (declared == null || declared.isEmpty()) {
      return List.of();
    }
    List<HealthCheckStatusDto> result = new ArrayList<>(declared.size());
    for (HealthCheckDto check : declared) {
      HealthCheckStatusDto live = set != null ? set.statusOf(check.name()) : null;
      result.add(
          live != null
              ? live
              : new HealthCheckStatusDto(
                  check.name(), check.kind(), HealthCheckState.UNKNOWN, null, null, null));
    }
    return result;
  }

  /** The latest results of one daemon instance's checks — one slot per check, never a history. */
  public static final class ProbeSet {

    /** Insertion-ordered by declaration; guarded by this set's monitor. */
    private final Map<String, CheckRuntime> byName = new LinkedHashMap<>();

    private boolean cancelled;

    /**
     * Stop all probing and freeze the state. A tick already blocked in {@code docker exec} finishes
     * the exec but drops its result — cancellation and result-writes are mutually exclusive under
     * this monitor.
     */
    synchronized void cancel() {
      cancelled = true;
      for (CheckRuntime runtime : byName.values()) {
        if (runtime.future != null) {
          runtime.future.cancel(false);
          runtime.future = null;
        }
      }
    }

    synchronized HealthCheckStatusDto statusOf(String name) {
      CheckRuntime runtime = byName.get(name);
      return runtime != null ? runtime.toStatus() : null;
    }
  }

  /** One check's runtime state; guarded by the owning {@link ProbeSet}'s monitor. */
  private static final class CheckRuntime {
    final HealthCheckDto check;
    HealthCheckState state = HealthCheckState.UNKNOWN;
    Long lastLatencyMs;
    Instant lastCheckedAt;
    String detail;
    int consecutiveSuccesses;
    int consecutiveFailures;
    boolean probeErrorLogged;
    ScheduledFuture<?> future;

    CheckRuntime(HealthCheckDto check) {
      this.check = check;
    }

    HealthCheckStatusDto toStatus() {
      return new HealthCheckStatusDto(
          check.name(), check.kind(), state, lastLatencyMs, lastCheckedAt, detail);
    }
  }

  /** One probe result before debouncing: the raw verdict of a single tick. */
  private record Outcome(HealthCheckState state, String detail) {}

  private void tick(
      ProbeSet set,
      CheckRuntime runtime,
      String container,
      Map<String, String> env,
      Runnable onStateFlip) {
    synchronized (set) {
      if (set.cancelled) {
        return;
      }
    }
    long timeoutMillis =
        runtime.check.timeoutMs() != null ? runtime.check.timeoutMs() : healthTimeoutMillis;
    Outcome outcome;
    long startedNanos = System.nanoTime();
    try {
      ContainerRuntime.ExecResult result =
          containers.exec(container, "/workspace", env, probeArgv(runtime.check, timeoutMillis));
      outcome = classify(runtime.check, result, timeoutMillis);
    } catch (RuntimeException e) {
      outcome = new Outcome(HealthCheckState.UNKNOWN, truncate("probe failed: " + e.getMessage()));
    }
    long latencyMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);

    boolean flipped;
    synchronized (set) {
      if (set.cancelled) {
        return;
      }
      if (outcome.state() == HealthCheckState.UNKNOWN && !runtime.probeErrorLogged) {
        LOG.warnf(
            "Health check '%s' could not run in %s: %s",
            runtime.check.name(), container, outcome.detail());
        runtime.probeErrorLogged = true;
      }
      flipped = applyResult(runtime, outcome, latencyMillis);
    }
    if (flipped && onStateFlip != null) {
      onStateFlip.run();
    }
  }

  /** Debounce one raw result into the public state; true when the public state flipped. */
  private static boolean applyResult(CheckRuntime runtime, Outcome outcome, long latencyMillis) {
    HealthCheckState before = runtime.state;
    switch (outcome.state()) {
      case HEALTHY -> {
        runtime.consecutiveSuccesses++;
        runtime.consecutiveFailures = 0;
        int threshold =
            runtime.check.healthyThreshold() != null ? runtime.check.healthyThreshold() : 1;
        if (runtime.consecutiveSuccesses >= threshold) {
          runtime.state = HealthCheckState.HEALTHY;
        }
      }
      case UNHEALTHY -> {
        runtime.consecutiveFailures++;
        runtime.consecutiveSuccesses = 0;
        int threshold =
            runtime.check.unhealthyThreshold() != null ? runtime.check.unhealthyThreshold() : 3;
        if (runtime.consecutiveFailures >= threshold) {
          runtime.state = HealthCheckState.UNHEALTHY;
        }
      }
      // A probe that couldn't run has no verdict — reset the streaks, don't debounce: "we can't
      // tell" must not masquerade as either healthy or down.
      case UNKNOWN -> {
        runtime.consecutiveSuccesses = 0;
        runtime.consecutiveFailures = 0;
        runtime.state = HealthCheckState.UNKNOWN;
      }
    }
    runtime.lastLatencyMs = latencyMillis;
    runtime.lastCheckedAt = Instant.now();
    runtime.detail = outcome.detail();
    return runtime.state != before;
  }

  /**
   * The in-container probe argv. HTTP is a plain curl argv (no shell ever touches the definition;
   * curl's own {@code -m} is the timeout); TCP and COMMAND run under bash wrapped in coreutils
   * {@code timeout} (a bare {@code /dev/tcp} connect can hang on a dropped SYN).
   */
  private static String[] probeArgv(HealthCheckDto check, long timeoutMillis) {
    String timeoutSeconds = String.format(Locale.ROOT, "%.3f", timeoutMillis / 1000.0);
    return switch (check.kind()) {
      case HTTP -> {
        String path = check.path() != null ? check.path() : "/";
        yield new String[] {
          "curl",
          "-sS",
          "-o",
          "/dev/null",
          "-m",
          timeoutSeconds,
          "-w",
          "%{http_code}",
          "http://127.0.0.1:" + check.port() + path
        };
      }
      case TCP ->
          new String[] {
            "timeout",
            timeoutSeconds,
            "bash",
            "-c",
            "exec 3<>/dev/tcp/127.0.0.1/" + check.port() + " && exec 3>&- 3<&-"
          };
      case COMMAND -> new String[] {"timeout", timeoutSeconds, "bash", "-c", check.command()};
    };
  }

  private static Outcome classify(
      HealthCheckDto check, ContainerRuntime.ExecResult result, long timeoutMillis) {
    String output = result.output() != null ? result.output().trim() : "";
    // The exec itself failed rather than the probed service (dead container, missing tool):
    // no verdict, not a red dot — a broken probe must not masquerade as a down service.
    if (result.exitCode() != 0 && output.contains("No such container")) {
      return new Outcome(HealthCheckState.UNKNOWN, truncate(output));
    }
    if (result.exitCode() == 126 || result.exitCode() == 127) {
      return new Outcome(HealthCheckState.UNKNOWN, truncate(output));
    }
    return switch (check.kind()) {
      case HTTP -> classifyHttp(check, result, output, timeoutMillis);
      case TCP, COMMAND -> {
        if (result.exitCode() == 0) {
          yield new Outcome(HealthCheckState.HEALTHY, null);
        }
        if (result.exitCode() == 124) { // coreutils timeout
          yield new Outcome(HealthCheckState.UNHEALTHY, "timed out after " + timeoutMillis + " ms");
        }
        yield new Outcome(
            HealthCheckState.UNHEALTHY, truncate("exit " + result.exitCode() + ": " + output));
      }
    };
  }

  private static Outcome classifyHttp(
      HealthCheckDto check, ContainerRuntime.ExecResult result, String output, long timeoutMillis) {
    if (result.exitCode() == 28) { // curl's own timeout
      return new Outcome(HealthCheckState.UNHEALTHY, "timed out after " + timeoutMillis + " ms");
    }
    if (result.exitCode() != 0) {
      return new Outcome(
          HealthCheckState.UNHEALTHY, truncate("exit " + result.exitCode() + ": " + output));
    }
    // -o /dev/null leaves only the -w '%{http_code}' on stdout, but stderr is merged into the
    // captured output, so read the code off the tail.
    if (output.length() < 3
        || !output.substring(output.length() - 3).chars().allMatch(Character::isDigit)) {
      return new Outcome(HealthCheckState.UNKNOWN, truncate("unparseable curl output: " + output));
    }
    int code = Integer.parseInt(output.substring(output.length() - 3));
    String expected =
        check.expectStatus() != null && !check.expectStatus().isBlank()
            ? check.expectStatus()
            : DEFAULT_EXPECT_STATUS;
    if (statusMatches(code, expected)) {
      return new Outcome(HealthCheckState.HEALTHY, "HTTP " + code);
    }
    return new Outcome(HealthCheckState.UNHEALTHY, "HTTP " + code + " (expected " + expected + ")");
  }

  /** Tokens are {@code NNN} exact or {@code Nxx} class matches, validated at definition time. */
  private static boolean statusMatches(int code, String expectStatus) {
    for (String token : expectStatus.split(",")) {
      String trimmed = token.trim().toLowerCase(Locale.ROOT);
      if (trimmed.endsWith("xx")) {
        if (code / 100 == trimmed.charAt(0) - '0') {
          return true;
        }
      } else if (String.valueOf(code).equals(trimmed)) {
        return true;
      }
    }
    return false;
  }

  /** Probe output may carry ANSI noise and be arbitrarily long — sanitize before caching. */
  private static String truncate(String detail) {
    if (detail == null) {
      return null;
    }
    String sanitized =
        detail
            .replaceAll("\u001B\\[[0-9;]*[A-Za-z]", "")
            .replaceAll("[\\p{Cntrl}&&[^\n]]", "")
            .strip();
    return sanitized.length() <= DETAIL_MAX ? sanitized : sanitized.substring(0, DETAIL_MAX) + "…";
  }
}
