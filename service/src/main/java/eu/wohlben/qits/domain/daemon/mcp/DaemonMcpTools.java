package eu.wohlben.qits.domain.daemon.mcp;

import eu.wohlben.qits.domain.daemon.control.DaemonSupervisor;
import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.dto.DaemonInstanceDto;
import eu.wohlben.qits.domain.daemon.dto.RepositoryDaemonDto;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.mapper.RepositoryDaemonMapper;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.repository.mcp.ProjectScopeGuard;
import io.quarkiverse.mcp.server.McpServer;
import io.quarkiverse.mcp.server.Tool;
import io.quarkiverse.mcp.server.ToolArg;
import io.quarkiverse.mcp.server.WrapBusinessError;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The daemon tools of the "repository" MCP server. A daemon is a repository's long-running,
 * non-interactive action (dev server, watch-mode test runner): it is defined <em>on the
 * repository</em> it serves — there is no global daemon scope — and runs supervised in a worktree.
 * Because the definition is part of working in that repository (the dev server to test against),
 * both managing daemons and running them live here, unlike actions whose global library is managed
 * on the separate "actions" server.
 *
 * <p>Scoping and error mapping follow {@link
 * eu.wohlben.qits.domain.repository.mcp.RepositoryMcpTools}: every tool takes a {@code repoId}
 * checked by {@link ProjectScopeGuard} against the session's project (and optional repository
 * narrowing), and {@link WrapBusinessError} renders domain exceptions as readable tool errors.
 */
@ApplicationScoped
@WrapBusinessError
public class DaemonMcpTools {

  @Inject ProjectScopeGuard scopeGuard;

  @Inject RepositoryDaemonService repositoryDaemonService;

  @Inject RepositoryDaemonMapper repositoryDaemonMapper;

  @Inject DaemonSupervisor daemonSupervisor;

  /**
   * One log observer as accepted by the daemon tools; mirrors the REST {@code LogObserverInput}.
   */
  public record ObserverArg(String kind, String pattern, String severity) {
    LogObserver toEntity() {
      LogObserverKind observerKind =
          parseEnum(LogObserverKind.class, kind, "observer kind", "PATTERN, LOG_LEVEL");
      DaemonEventSeverity observerSeverity =
          severity == null
              ? null
              : parseEnum(
                  DaemonEventSeverity.class, severity, "observer severity", "INFO, WARNING, ERROR");
      return new LogObserver(observerKind, pattern, observerSeverity);
    }

    static List<LogObserver> toEntities(List<ObserverArg> observers) {
      return observers == null ? null : observers.stream().map(ObserverArg::toEntity).toList();
    }
  }

  /** One tailed-file log source; mirrors the REST {@code LogSourceInput}. */
  public record SourceArg(String path, String label) {
    static List<LogSource> toEntities(List<SourceArg> sources) {
      return sources == null
          ? null
          : sources.stream().map(s -> new LogSource(s.path(), s.label())).toList();
    }
  }

  /** Result of deleting a daemon. */
  public record DeletedDaemon(String id, boolean deleted) {}

  // --- Definitions (management) ----------------------------------------------

  @McpServer("repository")
  @Tool(
      description =
          "List a repository's daemons — its long-running, non-interactive processes (dev server,"
              + " watch-mode test runner) with their start script, readiness pattern, restart"
              + " policy, environment, log observers and file log sources. Start here to obtain a"
              + " daemonId for the other daemon tools.")
  @Transactional
  public List<RepositoryDaemonDto> listDaemons(
      @ToolArg(description = "id of a repository in this project") String repoId) {
    scopeGuard.requireRepoInProject(repoId);
    return repositoryDaemonService.list(repoId).stream()
        .map(repositoryDaemonMapper::toDto)
        .toList();
  }

  @McpServer("repository")
  @Tool(
      description =
          "Define a daemon on a repository, e.g. its dev server. 'startScript' runs verbatim in the"
              + " worktree and must stay in the foreground. Optional: 'readyPattern' (regex; first"
              + " output match marks the daemon READY), 'stopSignal' (default TERM), 'restartPolicy'"
              + " (NEVER, ON_FAILURE or ALWAYS; default ON_FAILURE) with 'maxRestarts' (default 3),"
              + " 'environment', 'observers' (kind PATTERN needs a regex 'pattern' and a 'severity'"
              + " of INFO/WARNING/ERROR; kind LOG_LEVEL classifies by the level vocabulary in the"
              + " lines), and 'sources' (worktree-relative files to tail into the observers, in"
              + " addition to the process output).")
  @Transactional
  public RepositoryDaemonDto createDaemon(
      @ToolArg(description = "id of a repository in this project") String repoId,
      @ToolArg(description = "display name") String name,
      @ToolArg(required = false, description = "human description") String description,
      @ToolArg(description = "foreground shell command run in the worktree") String startScript,
      @ToolArg(required = false, description = "regex marking readiness on the output")
          String readyPattern,
      @ToolArg(required = false, description = "signal for a graceful stop (default TERM)")
          String stopSignal,
      @ToolArg(required = false, description = "NEVER, ON_FAILURE or ALWAYS (default ON_FAILURE)")
          String restartPolicy,
      @ToolArg(required = false, description = "relaunch attempts before settling CRASHED")
          Integer maxRestarts,
      @ToolArg(
              required = false,
              description =
                  "inject OTEL_EXPORTER_* env vars at launch so the process exports telemetry to"
                      + " qits (default false)")
          Boolean otel,
      @ToolArg(
              required = false,
              description =
                  "HTTP port the daemon serves inside its container; makes it web-viewable through"
                      + " the qits proxy")
          Integer httpPort,
      @ToolArg(required = false, description = "environment variables, as key/value pairs")
          Map<String, String> environment,
      @ToolArg(required = false, description = "log observers watching the daemon's output")
          List<ObserverArg> observers,
      @ToolArg(required = false, description = "worktree-relative log files to tail")
          List<SourceArg> sources) {
    scopeGuard.requireRepoInProject(repoId);
    var daemon =
        repositoryDaemonService.create(
            repoId,
            name,
            description,
            startScript,
            readyPattern,
            stopSignal,
            parseRestartPolicy(restartPolicy),
            maxRestarts,
            otel,
            httpPort,
            environment,
            ObserverArg.toEntities(observers),
            SourceArg.toEntities(sources));
    return repositoryDaemonMapper.toDto(daemon);
  }

  @McpServer("repository")
  @Tool(
      description =
          "Edit one of a repository's daemons. Only the fields you pass change; omit a field to"
              + " keep it. An empty 'readyPattern' clears it; 'environment', 'observers' and"
              + " 'sources', when given, replace the whole collection. A running instance keeps its"
              + " old definition until restarted.")
  @Transactional
  public RepositoryDaemonDto updateDaemon(
      @ToolArg(description = "id of a repository in this project") String repoId,
      @ToolArg(description = "id of the daemon to edit (see listDaemons)") String daemonId,
      @ToolArg(required = false, description = "new name") String name,
      @ToolArg(required = false, description = "new description") String description,
      @ToolArg(required = false, description = "new foreground start script") String startScript,
      @ToolArg(required = false, description = "new readiness regex ('' clears it)")
          String readyPattern,
      @ToolArg(required = false, description = "new stop signal") String stopSignal,
      @ToolArg(required = false, description = "new restart policy (NEVER/ON_FAILURE/ALWAYS)")
          String restartPolicy,
      @ToolArg(required = false, description = "new relaunch budget") Integer maxRestarts,
      @ToolArg(
              required = false,
              description =
                  "toggle OTEL_EXPORTER_* env injection (telemetry export to qits) at launch")
          Boolean otel,
      @ToolArg(
              required = false,
              description =
                  "new web-view HTTP port; 0 clears it (makes the daemon not web-viewable)")
          Integer httpPort,
      @ToolArg(required = false, description = "replacement environment, as key/value pairs")
          Map<String, String> environment,
      @ToolArg(required = false, description = "replacement log observers")
          List<ObserverArg> observers,
      @ToolArg(required = false, description = "replacement file log sources")
          List<SourceArg> sources) {
    scopeGuard.requireRepoInProject(repoId);
    var daemon =
        repositoryDaemonService.update(
            repoId,
            daemonId,
            name,
            description,
            startScript,
            readyPattern,
            stopSignal,
            parseRestartPolicy(restartPolicy),
            maxRestarts,
            otel,
            httpPort,
            environment,
            ObserverArg.toEntities(observers),
            SourceArg.toEntities(sources));
    return repositoryDaemonMapper.toDto(daemon);
  }

  @McpServer("repository")
  @Tool(description = "Delete one of a repository's daemons by id.")
  @Transactional
  public DeletedDaemon deleteDaemon(
      @ToolArg(description = "id of a repository in this project") String repoId,
      @ToolArg(description = "id of the daemon to delete") String daemonId) {
    scopeGuard.requireRepoInProject(repoId);
    repositoryDaemonService.delete(repoId, daemonId);
    return new DeletedDaemon(daemonId, true);
  }

  // --- Runtime (per worktree) -------------------------------------------------

  @McpServer("repository")
  @Tool(
      description =
          "List the repository's daemons with their supervised runtime state in one worktree"
              + " (STOPPED/STARTING/READY/DEGRADED/RESTARTING/CRASHED, restart count, and the"
              + " commandId whose log holds the daemon's output).")
  public List<DaemonInstanceDto> listWorktreeDaemons(
      @ToolArg(description = "id of a repository in this project") String repoId,
      @ToolArg(description = "id of the worktree (see listWorktrees)") String worktreeId) {
    scopeGuard.requireRepoInProject(repoId);
    return daemonSupervisor.effectiveDaemons(repoId, worktreeId);
  }

  @McpServer("repository")
  @Tool(
      description =
          "Start a daemon in a worktree under supervision. One running instance per (worktree,"
              + " daemon) — starting it twice is an error. Readiness, crashes and observer findings"
              + " surface as daemon events and as messages to the worktree's coding-agent chat.")
  public DaemonInstanceDto startDaemon(
      @ToolArg(description = "id of a repository in this project") String repoId,
      @ToolArg(description = "id of the worktree to run in") String worktreeId,
      @ToolArg(description = "id of the daemon to start (see listDaemons)") String daemonId) {
    scopeGuard.requireRepoInProject(repoId);
    return daemonSupervisor.start(repoId, worktreeId, daemonId);
  }

  @McpServer("repository")
  @Tool(
      description =
          "Gracefully stop a running daemon instance in a worktree: sends the daemon's stop signal,"
              + " then force-kills after a grace period. An explicit stop always beats the restart"
              + " policy.")
  public DaemonInstanceDto stopDaemon(
      @ToolArg(description = "id of a repository in this project") String repoId,
      @ToolArg(description = "id of the worktree it runs in") String worktreeId,
      @ToolArg(description = "id of the daemon to stop") String daemonId) {
    scopeGuard.requireRepoInProject(repoId);
    return daemonSupervisor.stop(repoId, worktreeId, daemonId);
  }

  // --- Parsing ----------------------------------------------------------------

  private static RestartPolicy parseRestartPolicy(String value) {
    return value == null
        ? null
        : parseEnum(RestartPolicy.class, value, "restartPolicy", "NEVER, ON_FAILURE, ALWAYS");
  }

  /** Case-insensitive enum parsing with a readable tool error instead of a Jackson failure. */
  private static <E extends Enum<E>> E parseEnum(
      Class<E> type, String value, String what, String allowed) {
    try {
      return Enum.valueOf(type, value.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException | NullPointerException e) {
      throw new BadRequestException("Invalid " + what + " '" + value + "'; one of: " + allowed);
    }
  }
}
