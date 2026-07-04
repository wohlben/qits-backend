package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.mapper.CommandMapper;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService.ResolvedAction;
import eu.wohlben.qits.domain.repository.control.GitExecutor;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
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

  /** Worktree ids are path segments, so they must be strict slugs (mirrors WorktreeService). */
  private static final String WORKTREE_ID_PATTERN = "[A-Za-z0-9_-]{1,64}";

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

  @Inject GitExecutor git;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

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
      CommandDto dto, Path worktreePath, String script, Map<String, String> env) {}

  /**
   * What a launch needs regardless of where it came from: an action or a coding agent. {@code
   * actionId} is null for agent launches (they aren't backed by an action).
   */
  private record LaunchDescriptor(
      String actionId,
      String name,
      String script,
      boolean interactive,
      Map<String, String> environment,
      CommandKind kind) {

    static LaunchDescriptor of(ResolvedAction action) {
      return new LaunchDescriptor(
          action.id(),
          action.name(),
          action.executeScript(),
          action.interactive(),
          action.environment(),
          CommandKind.TERMINAL);
    }
  }

  /** Launch an action as a registry command and return it; a terminal attaches by its id. */
  public CommandDto launch(String repoId, String worktreeId, String actionId) {
    ResolvedAction action = actionResolutionService.resolveForRepository(repoId, actionId);
    Prepared p = prepare(repoId, worktreeId, LaunchDescriptor.of(action));
    registry.spawn(
        p.dto().id(), p.worktreePath(), p.script(), p.env(), this::onExit, commandLogService);
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
      String worktreeId,
      String name,
      String script,
      boolean interactive,
      Map<String, String> environment) {
    Prepared p =
        prepare(
            repoId,
            worktreeId,
            new LaunchDescriptor(
                null, name, script, interactive, environment, CommandKind.TERMINAL));
    registry.spawn(
        p.dto().id(), p.worktreePath(), p.script(), p.env(), this::onExit, commandLogService);
    return p.dto();
  }

  /**
   * Launch a Claude stream-json chat session as a registry command (kind {@code CHAT}). Like {@link
   * #launchAgent} but the process is driven over plain pipes and rendered as a conversation; the
   * command is re-attachable and its stream-json events are persisted as its log.
   */
  public CommandDto launchChat(
      String repoId,
      String worktreeId,
      String name,
      String script,
      Map<String, String> environment) {
    Prepared p =
        prepare(
            repoId,
            worktreeId,
            new LaunchDescriptor(null, name, script, false, environment, CommandKind.CHAT));
    registry.spawnChat(
        p.dto().id(),
        p.worktreePath(),
        p.script(),
        p.env(),
        this::onExit,
        commandLogService,
        commandLogService);
    return p.dto();
  }

  /**
   * Launch a non-interactive action and block for its result (the one-off run path). The command is
   * still registered and persisted, so it shows up in the Commands list and survives as history.
   */
  public RunOutcome launchAndAwait(String repoId, String worktreeId, String actionId) {
    ResolvedAction action = actionResolutionService.resolveForRepository(repoId, actionId);
    if (action.interactive()) {
      throw new BadRequestException(
          "Action '"
              + action.name()
              + "' is interactive — run it from the terminal, not as a one-off command.");
    }
    Prepared p = prepare(repoId, worktreeId, LaunchDescriptor.of(action));
    AccumulatingSink sink = new AccumulatingSink();
    int exitCode =
        registry.spawnAndAwait(
            p.dto().id(),
            p.worktreePath(),
            p.script(),
            p.env(),
            this::onExit,
            commandLogService,
            TimeUnit.MINUTES.toMillis(AWAIT_TIMEOUT_MINUTES),
            sink);
    return new RunOutcome(action.id(), action.name(), exitCode, sink.text().stripTrailing());
  }

  /**
   * Validate the worktree, snapshot its branch/commit, and persist a RUNNING row — but don't spawn.
   */
  private Prepared prepare(String repoId, String worktreeId, LaunchDescriptor descriptor) {
    // Reject path-traversal in worktreeId before it ever reaches a filesystem path or git.
    if (!worktreeId.matches(WORKTREE_ID_PATTERN)) {
      throw new BadRequestException("Invalid worktree id: " + worktreeId);
    }
    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId).toAbsolutePath();
    if (!Files.exists(worktreePath)) {
      throw new BadRequestException("Worktree checkout missing on disk");
    }

    String branch = git.getCurrentBranch(worktreePath);
    String commitHash = git.getCurrentCommit(worktreePath);

    // Persist RUNNING first (this also validates the worktree belongs to the repo). If the spawn
    // fails afterwards the registry marks it via the exit listener; the row is never left dangling.
    CommandDto dto =
        lifecycle.createRunning(
            repoId,
            worktreeId,
            branch,
            commitHash,
            descriptor.actionId(),
            descriptor.name(),
            descriptor.script(),
            descriptor.interactive(),
            descriptor.kind());

    Map<String, String> env = new HashMap<>(System.getenv());
    env.put("TERM", "xterm-256color");
    env.putAll(descriptor.environment());

    return new Prepared(dto, worktreePath, descriptor.script(), env);
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

  /** A command's captured per-line log (the audit history). */
  public List<CommandLogLineDto> log(String commandId) {
    get(commandId); // validates existence (404 if unknown)
    return commandLogService.log(commandId);
  }

  @Transactional
  public List<CommandDto> list(String repoId, CommandStatus status) {
    List<Command> commands;
    if (repoId != null && !repoId.isBlank()) {
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
