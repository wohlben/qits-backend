# Container agent sessions: the coding agent works inside the workspace container (Phase 3)

## Introduction

The security payoff of [workspace containers](../features/2026-07-04_workspace-containers.md) only fully lands when
the **coding agent** — the single biggest executor of arbitrary commands in qits — runs inside
the sandbox. Phase 1's exec routing already carries chat commands mechanically; this phase is
about what the agent specifically needs: the CLI in the image, a credential hand-off that
doesn't defeat the sandbox, a git identity, and the harness contract surviving unchanged.

Related/dependent plans:

- **Phase 1 — [workspace-containers](../features/2026-07-04_workspace-containers.md)** (hard dependency). Independent
  of Phase 2 ([container-file-access](container-file-access.md)).
- The [coding-agent harness](../features/2026-07-01_coding-agent-harness.md) launch flow and
  the [stream-json chat](../features/2026-07-01_stream-json-chat.md) protocol are the things
  being relocated; the registry still owns stdin/stdout, so
  [persistent chat sessions](../features/2026-07-04_persistent-chat-sessions.md), the
  [worktree chat dialog](../features/2026-07-04_worktree-chat-dialog.md), and transcript
  restore work unchanged.
- The [daemons](../features/2026-07-04_daemons.md) agent-notification sink injects events by
  writing to the chat's stdin (`CommandRegistry.chatSend`) — that stdin is now a
  `docker exec -i` pipe, which changes nothing about the injection point. Daemon and agent
  share the same container, so "the dev server the agent just broke" is literally reachable at
  `localhost` from the agent's shell.

## Launch

Same registry `CHAT` command, new spawn line (Phase 1 mechanics):

```
docker exec -i -w /workspace <container> claude -p \
  --input-format stream-json --output-format stream-json --include-hook-events
```

- The `claude` CLI is baked into the workspace image at a pinned version.
- The repository's own `.claude/` directory and `CLAUDE.md` arrive with the clone — project
  configuration works with zero qits involvement. Repo-configured MCP servers consequently run
  *inside* the container, which is exactly where they belong.
- Hook-event handling, transcript persistence, ring replay, re-attach: registry-side,
  untouched.

## Credential hand-off

The one secret that must cross the boundary is the agent's own API credential. This deserves
explicit design because it is the exception to "no credentials inside":

- **Lean: per-session injection, nothing at rest.** Pass the credential via `-e` on the exec
  (API key) or copy a minimal token file into the container home at session start and remove
  it at session end. The container's filesystem should not durably hold a credential.
- **Rejected: mounting `~/.claude` into the container.** That hands the sandbox the very
  credential store — plus global settings, history, and every project's trust decisions — that
  the sandbox exists to protect. Over-broad by construction.
- Blast radius, stated: a compromised container can spend the injected credential (API usage)
  until revoked. It still cannot push anywhere external, read the host, or touch other repos'
  credentials.

Git identity: set once at container init (`git config user.name/user.email`, `qits@local`) so
agent commits just work; pushes go only to the qits-hosted origin.

## What the agent loses (deliberately)

- No host filesystem: no reading other repositories, dotfiles, or the qits H2 database.
- No external git remotes: publishing work is qits' host-side job, after integration.
- Host tools it silently relied on (globally installed CLIs) — anything the agent needs must
  be in the image; expect this to be the main source of image iteration.

## Open questions

- **Subscription auth vs API key**: headless `claude` under an OAuth/subscription login wants
  a token file with refresh semantics — which minimal subset of `~/.claude` state is
  sufficient, and does refresh-at-rest force a longer-lived copy than "per-session"?
- Should the injected credential be scoped/budgeted per worktree (spend caps), tying into the
  daemons feature's shared observer-budget decision?
- User-level (non-repo) agent config the user actually wants inside — a curated allowlist
  copied at init, or nothing?

## Testing sketch

- Fake executor: launching a chat for a containerized worktree produces the `docker exec -i`
  spawn line with cwd, flags, and credential env; session end removes any copied token file.
- Real-docker IT (behind `skipITs`): launch a chat, send a stream-json user message asking for
  a file write + commit + push; assert the commit appears in the bare origin; assert the
  container holds no credential file after session end.
- Injection regression: a daemon event written to the chat's stdin mid-session arrives as a
  user turn (same test shape as `DaemonAgentNotifierTest`, now through the exec pipe).
