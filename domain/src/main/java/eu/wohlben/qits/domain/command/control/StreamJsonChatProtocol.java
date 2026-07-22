package eu.wohlben.qits.domain.command.control;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.jboss.logging.Logger;

/**
 * The Claude Code chat transport: the process already speaks the stream-json event envelope on
 * plain pipes, so this protocol is a straight pass-through. Stdout lines are emitted verbatim onto
 * the {@link ChatWire}; a user turn is written to stdin as a stream-json {@code user} message and
 * echoed into the stream as a synthetic {@code {"type":"user","text":…}} line (the same one unified
 * stream the frontend renders). This is exactly the behavior {@link ChatSession} used to hold
 * inline, before the transport was made pluggable for Kimi's ACP client.
 */
final class StreamJsonChatProtocol implements ChatProtocol {

  private static final Logger LOG = Logger.getLogger(StreamJsonChatProtocol.class);

  private final ObjectMapper mapper = new ObjectMapper();
  private final Process process;
  private final String commandId;
  private final BufferedWriter stdin;
  private final Object stdinLock = new Object();

  private volatile ChatWire wire;

  StreamJsonChatProtocol(Process process, String commandId) {
    this.process = process;
    this.commandId = commandId;
    this.stdin =
        new BufferedWriter(
            new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
  }

  @Override
  public void start(ChatWire wire, Runnable onEnd) {
    this.wire = wire;
    Thread t = new Thread(() -> readLoop(onEnd), "chat-" + commandId);
    t.setDaemon(true);
    t.start();
  }

  private void readLoop(Runnable onEnd) {
    try (BufferedReader out =
        new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = out.readLine()) != null) {
        if (!line.isEmpty()) {
          wire.emit(line);
        }
      }
    } catch (IOException e) {
      LOG.debugf(e, "Chat output pump ended for command %s", commandId);
    } finally {
      onEnd.run();
    }
  }

  @Override
  public void sendUser(String text) {
    synchronized (stdinLock) {
      try {
        stdin.write(
            mapper.writeValueAsString(
                Map.of(
                    "type",
                    "user",
                    "message",
                    Map.of(
                        "role",
                        "user",
                        "content",
                        List.of(Map.of("type", "text", "text", text))))));
        stdin.write("\n");
        stdin.flush();
      } catch (IOException e) {
        LOG.debugf(e, "Chat stdin write failed for command %s", commandId);
        return;
      }
    }
    ChatWire w = wire;
    if (w == null) {
      return; // sendUser before start() bound the wire — unreachable via spawnChat, guarded anyway.
    }
    try {
      w.emit(mapper.writeValueAsString(Map.of("type", "user", "text", text)));
    } catch (IOException e) {
      LOG.debugf(e, "Chat user echo failed for command %s", commandId);
    }
  }

  @Override
  public void close() {
    try {
      stdin.close();
    } catch (IOException ignored) {
      // best effort
    }
  }
}
