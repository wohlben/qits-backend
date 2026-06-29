package eu.wohlben.qits.domain.featureflow.entity;

/**
 * A typed, backend-defined parameterization of an action. Most actions are {@link #SHELL} — their
 * {@code executeScript} runs verbatim. Special variants are rendered by the backend from run
 * context (e.g. the worktree's repository), so the dangerous flag-construction lives in code rather
 * than as user-supplied shell.
 *
 * <p>{@link #CLAUDE_ACTIONS_MCP} renders a Claude Code launch with the "actions" MCP server
 * attached and scoped to the repository it runs in. {@link #CLAUDE_REPOSITORY_MCP} renders one with
 * the "repository" MCP server attached, scoped to the worktree's project and narrowed to that one
 * repository — for driving a single repository from within a subtree. {@link #CLAUDE_PROJECT_MCP}
 * renders the same repository server scoped to the whole project (no repository narrowing) — for
 * driving every repository in a project. All are built by {@code
 * ActionResolutionService#renderCommand}.
 */
public enum ActionVariant {
  SHELL,
  CLAUDE_ACTIONS_MCP,
  CLAUDE_REPOSITORY_MCP,
  CLAUDE_PROJECT_MCP
}
