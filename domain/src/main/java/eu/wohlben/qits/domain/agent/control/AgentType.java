package eu.wohlben.qits.domain.agent.control;

/**
 * The kind of coding agent to launch. Selected via {@code CodingAgentFactory.ofType(...)}; each
 * value maps to a {@link CodingAgent} implementation that knows how to render its own process
 * invocation. Only {@link #CLAUDE} (Claude Code) exists today — the enum is the extension point for
 * additional harnesses.
 */
public enum AgentType {
  CLAUDE
}
