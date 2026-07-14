package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.command.entity.LogSeverity;
import eu.wohlben.qits.domain.command.mapper.CommandMapper;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService.ResolvedAction;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.jboss.logging.Logger;

/**
 * The public API for launching and managing registry-backed commands. A "launch" persists a {@link
 * Command} row (RUNNING) and spawns its process in the {@link CommandRegistry}, decoupled from any
 * connection — interactive runs are then watched by attaching a terminal to the returned command
 * id, non-interactive runs ({@link #launchAndAwait}) block for the result. Process end is reported
 * back through {@link #onExit} to {@link CommandLifecycleService}, the single writer of terminal
 * status.
 */
@ApplicationScoped
public class CommandService {

  private static final Logger LOG = Logger.getLogger(CommandService.class);

  /** Workspace ids are path segments, so they must be strict slugs (mirrors WorkspaceService). */
  private static final String WORKSPACE_ID_PATTERN = "[A-Za-z0-9_-]{1,64}";

  /** Canonical UUID shape for hook-reported session ids (they become transcript filenames). */
  private static final String UUID_PATTERN =
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

  /**
   * How long {@link #launchAndAwait} blocks before returning a still-running result. The process is
   * <em>not</em> killed on timeout — it keeps running in the registry and is manageable from the
   * Commands UI — this only bounds the synchronous caller (e.g. the MCP runAction tool).
   */
  private static final long AWAIT_TIMEOUT_MINUTES = 10;

  @Inject CommandRegistry registry;

  @Inject CommandLifecycleService lifecycle;

  @Inject CommandLogService commandLogService;

  @Inject CommandRepository commandRepository;

  @Inject CommandMapper commandMapper;

  @Inject ActionResolutionService actionResolutionService;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject WorkspaceService workspaceService;

  @Inject ContainerRuntime containers;

  @Inject OtelEnvironment otelEnvironment;

  /** The outcome of a non-interactive run: combined output and exit code. */
  public record RunOutcome(String actionId, String actionName, int exitCode, String output) {}

  /** Reconcile orphaned RUNNING rows from a previous JVM before anything new is launched. */
  void onStart(@Observes StartupEvent event) {
    int reconciled = lifecycle.reconcileRunningAsInterrupted();
    if (reconciled > 0) {
      LOG.infof("Reconciled %d interrupted command(s) from a previous run", reconciled);
    }
  }

  /** A persisted RUNNING command plus what the registry needs to spawn its process. */
  private record Prepared(
      CommandDto dto, String container, String script, Map<String, String> env) {}

  /**
   * What a launch needs regardless of where it came from: an action or a coding agent. {@code
   * actionId} is null for agent launches (they aren't backed by an action). {@code otel} injects
   * the OTLP exporter environment (daemons with the toggle set; see {@link OtelEnvironment}).
   * {@code publicBase} is the proxied base path a web-viewable daemon must serve under, injected as
   * {@code QITS_PUBLIC_BASE}; null for everything else. {@code commandId} is a caller-chosen id
   * (agent launches render it into the session-report hook URL before the row exists; null
   * generates one) and {@code agentSession} the first entry of an agent launch's session list —
   * both null for everything that isn't an agent session.
   */
  private record LaunchDescriptor(
      String actionId,
      String name,
      String script,
      boolean interactive,
      Map<String, String> environment,
      CommandKind kind,
      boolean otel,
      String publicBase,
      String commandId,
      AgentSessionRef agentSession) {

    static LaunchDescriptor of(ResolvedAction action) {
      return new LaunchDescriptor(
          action.id(),
          action.name(),
          action.executeScript(),
          action.interactive(),
          action.environment(),
          CommandKind.TERMINAL,
          false,
          null,
          null,
          null);
    }
  }

  /** Launch an action as a registry command and return it; a terminal attaches by its id. */
  public CommandDto launch(String repoId, String workspaceId, String actionId) {
    ResolvedAction action = actionResolutionService.resolveForRepository(repoId, actionId);
    Prepared p = prepare(repoId, workspaceId, LaunchDescriptor.of(action));
    registry.spawn(
        p.dto().id(), p.container(), p.script(), p.env(), this::onExit, commandLogService);
    return p.dto();
  }

  /**
   * Launch a coding-agent session (rendered by the agent path) as a registry command. Like {@link
   * #launch} but not backed by an action — the caller supplies the display name, the rendered
   * script, and an environment overlay. The command shows up in the Commands list and a terminal
   * attaches by its id, exactly like an action launch.
   */
  public CommandDto launchAgent(
      String repoId,
      String workspaceId,
      String name,
      String script,
      boolean interactive,
      Map<String, String> environment) {
    return launchAgent(
        repoId, workspaceId, name, script, interactive, environment, null, null, null);
  }

  /**
   * {@link #launchAgent} with session identity: {@code commandId} pre-names the row (it is rendered
   * into the script's session-report hook URL), {@code agentSession} is persisted as the first
   * entry of the command's session list, and {@code extraExitListener} runs after the status write
   * (the transcript sweep). All three may be null.
   */
  public CommandDto launchAgent(
      String repoId,
      String workspaceId,
      String name,
      String script,
      boolean interactive,
      Map<String, String> environment,
      String commandId,
      AgentSessionRef agentSession,
      CommandExitListener extraExitListener) {
    Prepared p =
        prepare(
            repoId,
            workspaceId,
            new LaunchDescriptor(
                null,
                name,
                script,
                interactive,
                environment,
                CommandKind.TERMINAL,
                false,
                null,
                commandId,
                agentSession));
    registry.spawn(
        p.dto().id(),
        p.container(),
        p.script(),
        p.env(),
        compose(extraExitListener),
        commandLogService);
    return p.dto();
  }

  /**
   * Launch a Claude stream-json chat session as a registry command (kind {@code CHAT}). Like {@link
   * #launchAgent} but the process is driven over plain pipes and rendered as a conversation; the
   * command is re-attachable and its stream-json events are persisted as its log.
   */
  public CommandDto launchChat(
      String repoId,
      String workspaceId,
      String name,
      String script,
      Map<String, String> environment) {
    return launchChat(repoId, workspaceId, name, script, environment, null, null, null);
  }

  /** {@link #launchChat} with session identity — same extra parameters as {@link #launchAgent}. */
  public CommandDto launchChat(
      String repoId,
      String workspaceId,
      String name,
      String script,
      Map<String, String> environment,
      String commandId,
      AgentSessionRef agentSession,
      CommandExitListener extraExitListener) {
    Prepared p =
        prepare(
            repoId,
            workspaceId,
            new LaunchDescriptor(
                null,
                name,
                script,
                false,
                environment,
                CommandKind.CHAT,
                false,
                null,
                commandId,
                agentSession));
    registry.spawnChat(
        p.dto().id(),
        p.container(),
        p.script(),
        p.env(),
        compose(extraExitListener),
        commandLogService,
        commandLogService);
    return p.dto();
  }

  /**
   * The lifecycle status write first (like {@link #launchDaemon}'s composite), then the extra
   * listener — so e.g. the transcript sweep sees the finished row.
   */
  private CommandExitListener compose(CommandExitListener extra) {
    if (extra == null) {
      return this::onExit;
    }
    return (commandId, exitCode, terminatedManually) -> {
      onExit(commandId, exitCode, terminatedManually);
      extra.onExit(commandId, exitCode, terminatedManually);
    };
  }

  /**
   * Launch a supervised daemon run as a registry command (kind {@code DAEMON}) — a PTY process like
   * an interactive action, so the existing terminal socket gives log tailing and re-attach. The
   * caller (the daemon supervisor) owns the lifecycle around it: {@code exitListener} is invoked
   * <em>after</em> the persisted status update, and {@code observerSinks} are attached before the
   * first output byte so ready/error observers never miss early lines. An optional {@code
   * logWriterTap} is teed onto the session's log writer, receiving every captured line with the
   * same sequence the audit log persists — the seam that lets observer findings anchor to {@code
   * command_log_line} rows.
   */
  public CommandDto launchDaemon(
      String repoId,
      String workspaceId,
      String name,
      String script,
      Map<String, String> environment,
      boolean otel,
      String publicBase,
      CommandExitListener exitListener,
      CommandLogWriter logWriterTap,
      CommandOutputSink... observerSinks) {
    Prepared p =
        prepare(
            repoId,
            workspaceId,
            new LaunchDescriptor(
                null,
                name,
                script,
                true,
                environment,
                CommandKind.DAEMON,
                otel,
                publicBase,
                null,
                null));
    CommandExitListener composite =
        (commandId, exitCode, terminatedManually) -> {
          onExit(commandId, exitCode, terminatedManually);
          exitListener.onExit(commandId, exitCode, terminatedManually);
        };
    CommandLogWriter logWriter =
        logWriterTap == null
            ? commandLogService
            : (commandId, sequence, channel, content, timestamp) -> {
              commandLogService.append(commandId, sequence, channel, content, timestamp);
              try {
                logWriterTap.append(commandId, sequence, channel, content, timestamp);
              } catch (RuntimeException e) {
                LOG.debugf(e, "Daemon log tap failed for command %s", commandId);
              }
            };
    registry.spawn(
        p.dto().id(), p.container(), p.script(), p.env(), composite, logWriter, observerSinks);
    return p.dto();
  }

  /** A prepared daemon run: the persisted RUNNING command row, its container, and resolved env. */
  public record DaemonRun(CommandDto command, String container, Map<String, String> environment) {}

  /**
   * Prepare a daemon run without spawning: validate the workspace, snapshot branch/commit, persist
   * a RUNNING {@code DAEMON} row, and resolve the env overlay (OTEL, {@code QITS_PUBLIC_BASE}, and
   * the caller's env). The {@link DaemonSupervisor} starts the detached daemon session with the
   * returned {@code environment}, then attaches a log follower to the returned command id via
   * {@link #followDaemon}. The row's {@code script} is the daemon's own startScript (meaningful
   * history), even though the process qits streams is the follower tail.
   */
  public DaemonRun beginDaemonRun(
      String repoId,
      String workspaceId,
      String name,
      String script,
      Map<String, String> environment,
      boolean otel,
      String publicBase) {
    Prepared p =
        prepare(
            repoId,
            workspaceId,
            new LaunchDescriptor(
                null,
                name,
                script,
                true,
                environment,
                CommandKind.DAEMON,
                otel,
                publicBase,
                null,
                null));
    return new DaemonRun(p.dto(), p.container(), p.env());
  }

  /**
   * Attach a follower process (the daemon's {@code tail -F} of its mirror log) to an
   * already-created command id, streaming its output through the same persistence + observer +
   * replay pipeline as any command — so the ready-pattern, log observers, per-line persistence, and
   * terminal re-attach all keep working while the daemon itself runs detached in its session. The
   * follower carries no daemon env (that rode into the session); its own exit does not drive daemon
   * lifecycle — the supervisor's liveness poll owns that.
   */
  public void followDaemon(
      String commandId,
      String container,
      String followScript,
      CommandExitListener exitListener,
      CommandLogWriter logWriterTap,
      CommandOutputSink... observerSinks) {
    CommandExitListener composite =
        (id, exitCode, terminatedManually) -> {
          onExit(id, exitCode, terminatedManually);
          exitListener.onExit(id, exitCode, terminatedManually);
        };
    CommandLogWriter logWriter =
        logWriterTap == null
            ? commandLogService
            : (id, sequence, channel, content, timestamp) -> {
              commandLogService.append(id, sequence, channel, content, timestamp);
              try {
                logWriterTap.append(id, sequence, channel, content, timestamp);
              } catch (RuntimeException e) {
                LOG.debugf(e, "Daemon log tap failed for command %s", id);
              }
            };
    registry.spawn(
        commandId,
        container,
        followScript,
        Map.of("TERM", "xterm-256color"),
        composite,
        logWriter,
        observerSinks);
  }

  /**
   * Launch a non-interactive action and block for its result (the one-off run path). The command is
   * still registered and persisted, so it shows up in the Commands list and survives as history.
   */
  public RunOutcome launchAndAwait(String repoId, String workspaceId, String actionId) {
    ResolvedAction action = actionResolutionService.resolveForRepository(repoId, actionId);
    if (action.interactive()) {
      throw new BadRequestException(
          "Action '"
              + action.name()
              + "' is interactive — run it from the terminal, not as a one-off command.");
    }
    Prepared p = prepare(repoId, workspaceId, LaunchDescriptor.of(action));
    AccumulatingSink sink = new AccumulatingSink();
    int exitCode =
        registry.spawnAndAwait(
            p.dto().id(),
            p.container(),
            p.script(),
            p.env(),
            this::onExit,
            commandLogService,
            TimeUnit.MINUTES.toMillis(AWAIT_TIMEOUT_MINUTES),
            sink);
    return new RunOutcome(action.id(), action.name(), exitCode, sink.text().stripTrailing());
  }

  /**
   * Validate the workspace, snapshot its branch/commit, and persist a RUNNING row — but don't
   * spawn.
   */
  private Prepared prepare(String repoId, String workspaceId, LaunchDescriptor descriptor) {
    // Reject path-traversal in workspaceId before it ever reaches a container name or git.
    if (!workspaceId.matches(WORKSPACE_ID_PATTERN)) {
      throw new BadRequestException("Invalid workspace id: " + workspaceId);
    }

    // Branch comes from the stored column. Read it in its own transaction: launches also come from
    // non-request threads (the daemon supervisor's scheduler on relaunch), where the Panache
    // session would otherwise have no active context.
    String branch =
        QuarkusTransaction.requiringNew()
            .call(
                () ->
                    workspaceRepository
                        .findActiveByRepositoryAndWorkspaceId(repoId, workspaceId)
                        .map(w -> w.branch)
                        .orElseThrow(
                            () -> new BadRequestException("Workspace not found: " + workspaceId)));

    // Provision the container on demand: a lost container is a recreatable cache of the durable
    // branch, not a dead workspace, so re-materialize it instead of failing. ensureContainer is a
    // no-op when it's already running (and never clobbers a live container's unpushed work); it
    // throws a clear error if the branch is gone or provisioning fails (e.g. git-host unreachable),
    // which the caller/UI surfaces rather than the old silent "container is not running" 400.
    workspaceService.ensureContainer(repoId, workspaceId);
    String container = containers.containerName(workspaceId, repoId);

    // The commit is read from the container's checkout so unpushed work is captured (the origin
    // ref may lag behind /workspace's HEAD).
    ContainerRuntime.ExecResult head =
        containers.exec(container, "/workspace", Map.of(), "git", "rev-parse", "HEAD");
    String commitHash = head.exitCode() == 0 ? head.output().trim() : null;

    // Persist RUNNING first (this also validates the workspace belongs to the repo). If the spawn
    // fails afterwards the registry marks it via the exit listener; the row is never left dangling.
    CommandDto dto =
        lifecycle.createRunning(
            repoId,
            workspaceId,
            branch,
            commitHash,
            descriptor.actionId(),
            descriptor.name(),
            descriptor.script(),
            descriptor.interactive(),
            descriptor.kind(),
            descriptor.commandId(),
            descriptor.agentSession());

    // Only the resolved overlay reaches the container (as `docker exec -e` flags) — the host
    // environment (and its credentials) is deliberately never inherited into a workspace container.
    Map<String, String> env = new HashMap<>();
    env.put("TERM", "xterm-256color");
    if (descriptor.otel()) {
      // The command id exists here (createRunning above) — each (re)launch exports with its own
      // qits.command.id. The definition overlay stays last so an explicit user OTEL_* var wins.
      env.putAll(otelEnvironment.forLaunch(repoId, workspaceId, dto.id(), descriptor.name()));
    }
    if (descriptor.publicBase() != null) {
      // Web-viewable daemons serve under the proxied base path (the startScript passes it to the
      // dev server, e.g. `vite --base "$QITS_PUBLIC_BASE"`). Before the definition overlay so an
      // explicit user var wins, like OTEL_* above.
      env.put("QITS_PUBLIC_BASE", descriptor.publicBase());
    }
    if (descriptor.kind() == CommandKind.DAEMON) {
      // Unconditional for daemons (like TERM, not behind the otel toggle): the backend relays it
      // to its SPA via config.json's capture section, and the app-side gate (env unset => capture
      // null => no button) handles absence everywhere else. Before the overlay so a user var wins.
      env.put("QITS_CAPTURE_ENDPOINT", otelEnvironment.captureEndpoint());
    }
    env.putAll(descriptor.environment());

    return new Prepared(dto, container, descriptor.script(), env);
  }

  /** The single bridge from a process ending to its persisted status (via the lifecycle proxy). */
  private void onExit(String commandId, int exitCode, boolean terminatedManually) {
    if (terminatedManually) {
      lifecycle.markTerminated(commandId, exitCode);
    } else {
      lifecycle.markExited(commandId, exitCode);
    }
  }

  /** Terminate a running command; returns its (now finished) state. No-op if already finished. */
  public CommandDto terminate(String commandId) {
    get(commandId); // validates existence
    registry.terminate(commandId); // kills + joins the reader, whose exit listener marks TERMINATED
    return get(commandId); // fresh read reflecting the committed status
  }

  @Transactional
  public CommandDto get(String commandId) {
    Command command = commandRepository.findById(commandId);
    if (command == null) {
      throw new NotFoundException("Command not found: " + commandId);
    }
    return commandMapper.toDto(command);
  }

  /** A command's captured per-line log (the audit history), optionally severity-filtered. */
  public List<CommandLogLineDto> log(String commandId, LogSeverity severity) {
    return log(commandId, severity, null);
  }

  /**
   * A command's captured per-line log (the audit history), optionally severity- and
   * channel-filtered. The channel filter separates intercepted stdio ({@code OUTPUT}) from the
   * imported agent transcript ({@code TRANSCRIPT}) so neither view double-renders the other. For a
   * chat, {@code TRANSCRIPT} means "the durable conversation": the transcript merged with its
   * persisted error results, or the full {@code OUTPUT} stream for pre-lineage chats that have no
   * transcript — scoped to {@code CHAT} so a terminal agent's transcript view never falls back to
   * raw PTY bytes.
   */
  public List<CommandLogLineDto> log(String commandId, LogSeverity severity, LogChannel channel) {
    CommandDto command = get(commandId); // validates existence (404 if unknown)
    if (channel == LogChannel.TRANSCRIPT && command.kind() == CommandKind.CHAT) {
      return commandLogService.chatLog(commandId, severity);
    }
    return commandLogService.log(commandId, severity, channel);
  }

  /**
   * Ingest a SessionStart hook report from inside the workspace container (see {@link
   * CommandLifecycleService#recordAgentSessionReport}). The endpoint is reachable without auth,
   * like the git host and the MCP servers, so everything is validated: the id must be a UUID (it
   * later becomes a transcript filename) and the command must exist and be running.
   */
  public CommandDto reportAgentSession(String commandId, String sessionId, String transcriptPath) {
    if (sessionId == null || !sessionId.matches(UUID_PATTERN)) {
      throw new BadRequestException("Invalid session id: " + sessionId);
    }
    return lifecycle.recordAgentSessionReport(commandId, sessionId, transcriptPath);
  }

  @Transactional
  public List<CommandDto> list(String repoId, String workspaceId, CommandStatus status) {
    List<Command> commands;
    if (workspaceId != null && !workspaceId.isBlank()) {
      // Workspace slugs are only unique within a repository, so the filter needs both.
      if (repoId == null || repoId.isBlank()) {
        throw new BadRequestException("workspaceId filter requires repoId");
      }
      commands = commandRepository.findByRepositoryAndWorkspace(repoId, workspaceId);
    } else if (repoId != null && !repoId.isBlank()) {
      commands = commandRepository.findByRepository(repoId);
    } else if (status != null) {
      commands = commandRepository.findByStatus(status);
    } else {
      commands = commandRepository.listAllByLaunchedAtDesc();
    }
    return commands.stream()
        .filter(c -> status == null || c.status == status)
        .map(commandMapper::toDto)
        .toList();
  }

  /**
   * Captures a non-interactive command's full output for the synchronous {@link #launchAndAwait}.
   */
  private static final class AccumulatingSink implements CommandOutputSink {
    private final StringBuilder buffer = new StringBuilder();

    @Override
    public synchronized void write(String data) {
      buffer.append(data);
    }

    @Override
    public boolean isOpen() {
      return true;
    }

    synchronized String text() {
      return buffer.toString();
    }
  }
}
