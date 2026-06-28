# Backlog

Loose TODOs and things to revisit. Not full feature/bug docs — promote to
`docs/feature-ideas/` or `docs/bugs/` when one is picked up.

## TODO: rethink action variants — the typed enum is a flawed concept

Introduced in commit `06e75ff` ("feat(actions): typed action variants + 'Configure
actions with Claude' launch").

The current model adds an `ActionVariant` enum (`SHELL`, `CLAUDE_ACTIONS_MCP`) to an
action, where special variants are rendered into a command by backend code
(`ActionResolutionService#renderCommand`). It works for the one case it was built
for, but it does **not** extend cleanly:

- **The enum doesn't scale.** Every new parameterized launch becomes another
  hard-coded enum value plus a bespoke backend renderer. The set of "kinds" grows
  without bound and the rendering logic accumulates special cases.
- **It doesn't generalize across harnesses.** `CLAUDE_ACTIONS_MCP` bakes in one
  specific agent CLI's MCP wiring (Claude Code's `--strict-mcp-config --mcp-config`).
  Other harnesses/agents configure MCP (and everything else) differently, so we'd
  need a separate variant per harness × per capability — a combinatorial mess that
  conflates *what to attach* (an MCP server scoped to a repo) with *how a particular
  CLI is invoked*.

A more fundamental approach is needed — something that separates the **capability**
(e.g. "attach this repo-scoped MCP server", "set this env/context") from the
**harness** that consumes it, so capabilities compose and new harnesses don't each
require new enum values + renderers. Likely directions to explore: a small set of
composable, declarative capabilities + per-harness adapters that translate them into
that harness's invocation, rather than one enum of fully-rendered command kinds.

Until then, `CLAUDE_ACTIONS_MCP` stays as the single working instance; do not keep
adding enum values on top of it.
