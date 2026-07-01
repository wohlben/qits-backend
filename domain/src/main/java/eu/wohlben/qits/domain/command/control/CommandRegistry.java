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

  /**
   * Stream-json chat sessions (plain-pipe, line-oriented), keyed the same way as {@link #sessions}.
   */
  private final Map<String, ChatSession> chats = new ConcurrentHashMap<>();

  /** Spawn a process for {@code commandId} with optional sinks attached before output starts. */
  public void spawn(
      String commandId,
      Path worktreePath,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      CommandOutputSink... initialSinks) {
    startSession(
        commandId, worktreePath, script, environment, exitListener, logWriter, initialSinks);
  }

  /**
   * Spawn a process and block until it exits (or the timeout elapses), returning its exit code.
   * Used for the synchronous non-interactive path. Holds the session reference directly, so a fast
   * command that finishes and removes itself from the registry before this returns is still awaited
   * correctly.
   */
  public int spawnAndAwait(
      String commandId,
      Path worktreePath,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      long timeoutMillis,
      CommandOutputSink... initialSinks) {
    CommandSession session =
        startSession(
            commandId, worktreePath, script, environment, exitListener, logWriter, initialSinks);
    return session.awaitExit(timeoutMillis);
  }

  /**
   * Spawn a Claude stream-json chat process (kind {@code CHAT}) on plain pipes — not a PTY, which
   * would echo input and corrupt the line-delimited JSON. Registry-tracked and re-attachable
   * exactly like {@link #spawn}.
   */
  public void spawnChat(
      String commandId,
      Path worktreePath,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
      CommandOutputSink... initialSinks) {
    Process process;
    try {
      ProcessBuilder pb = new ProcessBuilder("/bin/bash", "-lc", script);
      pb.directory(worktreePath.toFile());
      pb.environment().putAll(environment);
      // Keep stderr off the JSON stdout stream (it would corrupt parsing); route it to the log.
      pb.redirectError(ProcessBuilder.Redirect.INHERIT);
      process = pb.start();
    } catch (IOException e) {
      throw new InternalServerErrorException("Failed to start chat: " + e.getMessage());
    }
    ChatSession session =
        new ChatSession(commandId, process, exitListener, () -> chats.remove(commandId), logWriter);
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
      Path worktreePath,
      String script,
      Map<String, String> environment,
      CommandExitListener exitListener,
      CommandLogWriter logWriter,
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
        new CommandSession(
            commandId, process, exitListener, () -> sessions.remove(commandId), logWriter);
    for (CommandOutputSink sink : initialSinks) {
      session.addInitialSink(sink);
    }
    sessions.put(commandId, session);
    session.startReader();
    return session;
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
