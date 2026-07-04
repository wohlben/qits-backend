package eu.wohlben.qits.domain.command.control;

import com.pty4j.PtyProcess;
import com.pty4j.PtyProcessBuilder;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * The live registry of running command processes, keyed by durable command id. Owns each {@link
 * CommandSession} (its PTY process, reader thread, scrollback buffer and attached sinks)
 * independent of any client connection, so processes survive disconnects and can be re-attached.
 * This is the only app-scoped stateful singleton in the codebase; it deliberately performs
 * <em>no</em> automatic cleanup — a process ends only by exiting itself or via {@link #terminate}.
 *
 * <p>It is persistence-agnostic: when a process ends, the session invokes the {@link
 * CommandExitListener} supplied at spawn time, which {@code CommandService} wires to the status
 * update. The registry never touches the database.
 */
@ApplicationScoped
public class CommandRegistry {

  private final Map<String, CommandSession> sessions = new ConcurrentHashMap<>();

  /**
   * Stream-json chat sessions (plain-pipe, line-oriented), keyed the same way as {@link #sessions}.
   */
  private final Map<String, ChatSession> chats = new ConcurrentHashMap<>();

  @Inject ContainerRuntime containers;

  /** Grace period before a graceful stop escalates to SIGKILL then a container restart. */
  @ConfigProperty(name = "qits.workspace.term-grace-ms", defaultValue = "5000")
  long graceMillis;

  /** Spawn a process for {@code commandId} with optional sinks attached before output starts. */
  public void spawn(
      String commandId,
      String container,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      CommandOutputSink... initialSinks) {
    startSession(commandId, container, script, environment, exitListener, logWriter, initialSinks);
  }

  /**
   * Spawn a process and block until it exits (or the timeout elapses), returning its exit code.
   * Used for the synchronous non-interactive path. Holds the session reference directly, so a fast
   * command that finishes and removes itself from the registry before this returns is still awaited
   * correctly.
   */
  public int spawnAndAwait(
      String commandId,
      String container,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      long timeoutMillis,
      CommandOutputSink... initialSinks) {
    CommandSession session =
        startSession(
            commandId, container, script, environment, exitListener, logWriter, initialSinks);
    return session.awaitExit(timeoutMillis);
  }

  /**
   * Spawn a Claude stream-json chat process (kind {@code CHAT}) on plain pipes — not a PTY, which
   * would echo input and corrupt the line-delimited JSON. Registry-tracked and re-attachable
   * exactly like {@link #spawn}.
   */
  public void spawnChat(
      String commandId,
      String container,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      CommandLogReader logReader,
      CommandOutputSink... initialSinks) {
    Process process;
    try {
      // Plain pipe into the container (no -t): a TTY would echo input and corrupt the
      // line-delimited
      // JSON. The client process runs on the host and inherits its env so the docker binary is on
      // PATH; the container-side env travels as -e flags inside the exec argv.
      ProcessBuilder pb =
          new ProcessBuilder(dockerExec(container, false, environment, commandId, script));
      // Keep stderr off the JSON stdout stream (it would corrupt parsing); route it to the log.
      pb.redirectError(ProcessBuilder.Redirect.INHERIT);
      process = pb.start();
    } catch (IOException e) {
      throw new InternalServerErrorException("Failed to start chat: " + e.getMessage());
    }
    ChatSession session =
        new ChatSession(
            commandId,
            process,
            container,
            containers,
            graceMillis,
            exitListener,
            () -> chats.remove(commandId),
            logWriter,
            logReader);
    for (CommandOutputSink sink : initialSinks) {
      session.addInitialSink(sink);
    }
    chats.put(commandId, session);
    session.startReader();
  }

  /** Send a user turn to a running chat command; false if it is not a running chat. */
  public boolean chatSend(String commandId, String text) {
    ChatSession session = chats.get(commandId);
    if (session == null) {
      return false;
    }
    session.sendUser(text);
    return true;
  }

  private CommandSession startSession(
      String commandId,
      String container,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      CommandOutputSink... initialSinks) {
    PtyProcess process;
    try {
      // The PtyProcess is the host-side `docker exec -it` client; pty4j's outer PTY drives the
      // inner container TTY (resize, colors, full-screen apps). The client inherits the host env so
      // the docker binary is on PATH; the container-side env travels as -e flags in the argv.
      Map<String, String> clientEnv = new HashMap<>(System.getenv());
      clientEnv.put("TERM", "xterm-256color");
      process =
          new PtyProcessBuilder()
              .setCommand(dockerExec(container, true, environment, commandId, script))
              .setDirectory(System.getProperty("user.home"))
              .setEnvironment(clientEnv)
              .setInitialColumns(80)
              .setInitialRows(24)
              .start();
    } catch (IOException e) {
      throw new InternalServerErrorException("Failed to start command: " + e.getMessage());
    }

    CommandSession session =
        new CommandSession(
            commandId,
            process,
            container,
            containers,
            graceMillis,
            exitListener,
            () -> sessions.remove(commandId),
            logWriter);
    for (CommandOutputSink sink : initialSinks) {
      session.addInitialSink(sink);
    }
    sessions.put(commandId, session);
    session.startReader();
    return session;
  }

  /**
   * The full {@code docker exec} argv that runs {@code script} inside {@code container}: the
   * runtime exec prefix (with the container-side {@code -e} env and {@code -w /workspace}) plus a
   * wrapper that records the launched shell's process-group id to a pid file before running the
   * script. {@code terminate()}/{@code signal()} read that pid file to kill the whole group inside
   * the container — killing the host-side exec client alone would orphan the process.
   *
   * <p>The TTY path ({@code -it}) needs no {@code setsid}: {@code docker exec -it} already makes
   * the shell a session leader owning the inner TTY, so {@code $$} is its process-group id (and
   * {@code setsid -c} would fail with EPERM re-stealing the controlling terminal). The no-TTY pipe
   * path ({@code -i}, chats) prepends {@code setsid} so the shell still becomes a group leader
   * {@code kill -- -pgid} can address.
   *
   * <p>The script runs as the shell body, not {@code exec}'d: {@code $$} (the login shell) is the
   * group leader that {@code kill -- -pgid} reaches along with its children. It is deliberately not
   * {@code exec}'d — a compound script ({@code while …; do …; done}) is not a simple command {@code
   * exec} can take — but a script that wants a single leader process can still {@code exec} its own
   * target (the shell keeps the same pid, so the recorded pgid stays valid).
   */
  private String[] dockerExec(
      String container,
      boolean tty,
      Map<String, String> environment,
      String commandId,
      String script) {
    List<String> cmd =
        new ArrayList<>(containers.execArgv(container, tty, "/workspace", environment));
    if (!tty) {
      cmd.add("setsid");
    }
    cmd.add("bash");
    cmd.add("-lc");
    cmd.add("echo $$ > /tmp/qits-cmd-" + commandId + ".pid; " + script);
    return cmd.toArray(new String[0]);
  }

  /** Attach a live client to a running command (terminal or chat); false if none is running. */
  public boolean attach(String commandId, CommandOutputSink sink) {
    CommandSession session = sessions.get(commandId);
    if (session != null) {
      session.attach(sink);
      return true;
    }
    ChatSession chat = chats.get(commandId);
    if (chat != null) {
      chat.attach(sink);
      return true;
    }
    return false;
  }

  public void detach(String commandId, CommandOutputSink sink) {
    CommandSession session = sessions.get(commandId);
    if (session != null) {
      session.detach(sink);
    }
    ChatSession chat = chats.get(commandId);
    if (chat != null) {
      chat.detach(sink);
    }
  }

  public boolean input(String commandId, byte[] data) {
    CommandSession session = sessions.get(commandId);
    if (session == null) {
      return false;
    }
    session.input(data);
    return true;
  }

  public boolean resize(String commandId, int cols, int rows) {
    CommandSession session = sessions.get(commandId);
    if (session == null) {
      return false;
    }
    session.resize(cols, rows);
    return true;
  }

  /**
   * Send a named signal (e.g. TERM) to a running PTY command's process group — the graceful half of
   * a daemon stop. False if the command is not a running PTY session or delivery failed.
   */
  public boolean signal(String commandId, String signal) {
    CommandSession session = sessions.get(commandId);
    return session != null && session.signal(signal);
  }

  /** Force-kill a running command (terminal or chat); false if it is not in the registry. */
  public boolean terminate(String commandId) {
    CommandSession session = sessions.get(commandId);
    if (session != null) {
      session.terminate();
      return true;
    }
    ChatSession chat = chats.get(commandId);
    if (chat != null) {
      chat.terminate();
      return true;
    }
    return false;
  }

  public boolean isRunning(String commandId) {
    CommandSession session = sessions.get(commandId);
    if (session != null) {
      return session.isAlive();
    }
    ChatSession chat = chats.get(commandId);
    return chat != null && chat.isAlive();
  }
}
