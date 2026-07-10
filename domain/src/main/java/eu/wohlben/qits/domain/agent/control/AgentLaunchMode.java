package eu.wohlben.qits.domain.agent.control;

/** How an agent launch is driven and rendered. */
public enum AgentLaunchMode {
  /** The stream-json conversation over pipes, rendered as a chat (the default). */
  CHAT,
  /** The full interactive Claude Code TUI over a PTY, rendered in xterm.js. */
  INTERACTIVE
}
