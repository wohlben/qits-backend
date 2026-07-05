# Coding Agent

A coding agent is an AI agent (today: Claude Code) that QITS launches into a workspace to do or configure work. Agents are a first-class concept — not specially-typed actions: a harness abstraction assembles each launch from composable capabilities (scoped tool servers, tool allowlists, an initial prompt, a model choice), and every invocation across the application goes through it.

What makes an agent launch meaningful is its **scope** — the tool server it is connected to:

- **Actions scope** — the agent manages the repository's runnable actions (creating and tuning repository-scoped action configurations).
- **Repository scope** — the agent works one repository: branches, workspaces, commits, running actions, integrating changes.
- **Project scope** — the same working surface across all of a project's repositories.

Agents are granted read tools without prompts; sessions run auto-approved so they can actually make changes.

Every agent session is a **command** (see the command domain): it appears in the Commands list, survives disconnects and navigation, can be terminated, and its full conversation is persisted and replayable. Interactive sessions are rendered as a **native chat** — bubbles, tool activity, thinking — rather than a raw terminal; autonomous one-shot runs (like conflict resolution) use the same harness headlessly.

## User Stories

- [Configure with Claude](configure-with-claude.md)
- [Chat with Agent](chat-with-agent.md)
- [Speak a Prompt](speak-a-prompt.md)
