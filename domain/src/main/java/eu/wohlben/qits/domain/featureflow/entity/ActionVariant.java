package eu.wohlben.qits.domain.featureflow.entity;

/**
 * A typed, backend-defined parameterization of an action. Most actions are {@link #SHELL} — their
 * {@code executeScript} runs verbatim. Special variants are rendered by the backend from run
 * context (e.g. the worktree's repository), so the dangerous flag-construction lives in code rather
 * than as user-supplied shell.
 *
 * <p>{@link #CLAUDE_ACTIONS_MCP} renders a Claude Code launch with the "actions" MCP server
 * attached and scoped to the repository it runs in — see {@code
 * ActionResolutionService#renderCommand}.
 */
public enum ActionVariant {
  SHELL,
  CLAUDE_ACTIONS_MCP
}
