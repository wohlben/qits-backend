package eu.wohlben.qits.domain.command.control;

/**
 * A destination for a command's terminal output — the registry fans every chunk of PTY output out
 * to all attached sinks. Kept framework-free (no websockets.next type) so the registry can live in
 * the domain module; the service-module websocket adapts a connection to a sink.
 */
public interface CommandOutputSink {

  /**
   * Forward a chunk of already terminal-encoded output to the client (written verbatim to xterm).
   */
  void write(String data);

  /** Whether this sink can still receive output; the registry prunes sinks that report false. */
  boolean isOpen();
}
