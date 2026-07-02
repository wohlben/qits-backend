# User Flows

User flows describe end-to-end behaviors that actors perform within QITS.

Each subdirectory represents a distinct business domain. Domains are coarse-grained groupings of related behavior. The current domains are:

- **project** — the shared scope that groups repositories, feature flows, and actions.
- **repository** — onboarding codebases, keeping them in sync with their remotes, and inspecting their commit history.
- **worktree** — the change lifecycle: proposing, reviewing, integrating, abandoning, and remembering units of work.
- **command** — persistent, re-attachable process execution with a full audit trail.
- **coding-agent** — launching and conversing with coding agents (Claude Code) that do the work.
- **feature-flow** — standardized lifecycle pipelines for units of work.
- **action-configuration** — reusable units of executable work.

Inside a domain you will find:

- a `README.md` explaining what the domain is and why it matters
- individual `$user-story.md` files describing specific behaviors
- optional subdirectories for further granularity, each with their own `README.md`
