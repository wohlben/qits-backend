package eu.wohlben.qits.domain.chat.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.command.control.CommandOutputSink;
import eu.wohlben.qits.domain.command.control.CommandRegistry;
import io.quarkus.websockets.next.OnClose;
import io.quarkus.websockets.next.OnOpen;
import io.quarkus.websockets.next.OnTextMessage;
import io.quarkus.websockets.next.PathParam;
import io.quarkus.websockets.next.WebSocket;
import io.quarkus.websockets.next.WebSocketConnection;
import io.smallrye.common.annotation.RunOnVirtualThread;
import jakarta.inject.Inject;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.jboss.logging.Logger;

/**
 * Attaches a browser to a running {@code CHAT} command and streams its stream-json conversation.
 * The chat process is owned by the {@link CommandRegistry} independent of this connection: opening
 * the socket <em>attaches</em> (replaying the buffered conversation so you pick up where you left
 * off) and closing it only <em>detaches</em> — the session keeps running until it exits or is
 * terminated.
 *
 * <p>Wire protocol: the server sends the raw stream-json event lines (newline-delimited; the client
 * splits and parses each into chat bubbles); the client sends {@code {"type":"user","text":"…"}}
 * per turn, which is forwarded to the Claude process's stdin. Mirrors {@code TerminalSocket};
 * cross-origin handshakes are rejected globally by {@code SameOriginUpgradeCheck}.
 */
@WebSocket(path = "/api/chat/commands/{commandId}")
public class ChatCommandSocket {

  private static final Logger LOG = Logger.getLogger(ChatCommandSocket.class);

  private final Map<String, CommandOutputSink> sinks = new ConcurrentHashMap<>();

  @Inject CommandRegistry registry;

  @Inject ObjectMapper objectMapper;

  @OnOpen
  @RunOnVirtualThread
  public void onOpen(@PathParam("commandId") String commandId, WebSocketConnection connection) {
    CommandOutputSink sink = new ConnectionSink(connection);
    if (!registry.attach(commandId, sink)) {
      connection.sendTextAndAwait("{\"type\":\"session_closed\"}");
      connection.closeAndAwait();
      return;
    }
    sinks.put(connection.id(), sink);
  }

  @OnTextMessage
  @RunOnVirtualThread
  public void onMessage(
      String message, @PathParam("commandId") String commandId, WebSocketConnection connection) {
    if (!sinks.containsKey(connection.id())) {
      return;
    }
    try {
      JsonNode node = objectMapper.readTree(message);
      if ("user".equals(node.path("type").asText())) {
        registry.chatSend(commandId, node.path("text").asText());
      }
    } catch (IOException e) {
      LOG.debugf(e, "Chat message parse failed for connection %s", connection.id());
    }
  }

  @OnClose
  public void onClose(@PathParam("commandId") String commandId, WebSocketConnection connection) {
    CommandOutputSink sink = sinks.remove(connection.id());
    if (sink != null) {
      // Detach only — the chat process outlives the browser tab until it exits or is terminated.
      registry.detach(commandId, sink);
    }
  }

  /** Bridges a websocket connection to the registry's framework-free output sink. */
  private static final class ConnectionSink implements CommandOutputSink {
    private final WebSocketConnection connection;

    ConnectionSink(WebSocketConnection connection) {
      this.connection = connection;
    }

    @Override
    public void write(String data) {
      if (connection.isOpen()) {
        connection.sendTextAndAwait(data);
      }
    }

    @Override
    public boolean isOpen() {
      return connection.isOpen();
    }
  }
}
