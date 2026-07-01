package eu.wohlben.qits.domain.command.entity;

/**
 * How a command's process is driven and rendered. {@link #TERMINAL} is an interactive PTY streamed
 * to xterm.js (shells, {@code claude} in a terminal, one-off runs); {@link #CHAT} is a Claude Code
 * session driven over the stream-json protocol on plain pipes and rendered as a conversation. The
 * frontend routes the command view on this.
 */
public enum CommandKind {
  TERMINAL,
  CHAT
}
