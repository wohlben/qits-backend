package eu.wohlben.qits.domain.command.control;

import com.pty4j.PtyProcess;
import com.pty4j.PtyProcessBuilder;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

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

  /** Spawn a process for {@code commandId} with optional sinks attached before output starts. */
  public void spawn(
      String commandId,
      Path worktreePath,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandOutputSink... initialSinks) {
    PtyProcess process;
    try {
      // executeScript is a shell line, so run it through a login shell. Seeded interactive actions
      // `exec` their target so a single PTY-leader process remains for terminate()'s SIGKILL.
      process =
          new PtyProcessBuilder()
              .setCommand(new String[] {"/bin/bash", "-lc", script})
              .setDirectory(worktreePath.toString())
              .setEnvironment(environment)
              .setInitialColumns(80)
              .setInitialRows(24)
              .start();
    } catch (IOException e) {
      throw new InternalServerErrorException("Failed to start command: " + e.getMessage());
    }

    CommandSession session =
        new CommandSession(commandId, process, exitListener, () -> sessions.remove(commandId));
    for (CommandOutputSink sink : initialSinks) {
      session.addInitialSink(sink);
    }
    sessions.put(commandId, session);
    session.startReader();
  }

  /** Attach a live client to a running command; false if no such command is running. */
  public boolean attach(String commandId, CommandOutputSink sink) {
    CommandSession session = sessions.get(commandId);
    if (session == null) {
      return false;
    }
    session.attach(sink);
    return true;
  }

  public void detach(String commandId, CommandOutputSink sink) {
    CommandSession session = sessions.get(commandId);
    if (session != null) {
      session.detach(sink);
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

  /** Force-kill a running command; false if it is not (or no longer) in the registry. */
  public boolean terminate(String commandId) {
    CommandSession session = sessions.get(commandId);
    if (session == null) {
      return false;
    }
    session.terminate();
    return true;
  }

  public boolean isRunning(String commandId) {
    CommandSession session = sessions.get(commandId);
    return session != null && session.isAlive();
  }

  /** Block until the command's process exits (or timeout); returns the exit code, or -1. */
  public int awaitExit(String commandId, long timeoutMillis) {
    CommandSession session = sessions.get(commandId);
    return session == null ? -1 : session.awaitExit(timeoutMillis);
  }
}
