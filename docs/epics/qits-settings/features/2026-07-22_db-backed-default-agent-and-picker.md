# DB-backed default agent + a workspace agent picker

## Introduction

Today the coding-agent harness is a **build/deploy-time global**: `qits.agent.type=claude|kimi` (a
MicroProfile property, default `claude`) read by six services, one harness per deployment, no
runtime choice. This feature makes agent selection **configurable at instance level**:

1. a **generic, DB-backed settings** backbone (a key/value store for qits-wide configuration), and
2. the **default coding agent** as its first setting — plus a per-launch **agent dropdown** on the
   workspace Agents/Chat tab so an operator can launch either harness without redeploying.

The default agent becomes a **database value**, not a property; the resolved harness is a two-level
**hierarchy** (qits-wide default → the workspace-tab "final decision"), deliberately built to grow
more levels later.

Related / dependent plans:

- **Depends on [kimi-code-harness](../../qits-coding-agents/features/2026-07-20_kimi-code-harness.md)
  and [kimi-code-acp-chat](../../qits-coding-agents/features/2026-07-22_kimi-code-acp-chat.md)** —
  there must be two working harnesses to choose between; both interactive/autonomous and chat now
  work for kimi and claude.
- **Supersedes the `qits.agent.type` property** established by the harness feature (the property
  becomes at most a one-time bootstrap seed; the DB row is the source of truth).
- **Surfaced by [qits-workspace-detail](../../qits-workspace-detail/epic.md)** — the Agents-tab
  (`workspace-agent-session.component.ts`) and Chat-tab (`workspace-chat.component.ts`) host the
  dropdown.
- First occupant of the new **[qits-settings](../epic.md)** epic; the settings backbone it
  introduces is intended to hold other qits-wide configuration over time.

## Problem: where the harness is a global today

`qits.agent.type` (default `claude`, set in `service/` and `cli/` `application.properties`) is read
by, per `@ConfigProperty`:

- `AgentLaunchService` — which harness to render for every chat/interactive/autonomous launch, the
  display names, the auth gate, and the login terminal.
- `AgentTranscriptService` / `AgentTranscriptTailService` — the transcript **layout** to import
  (claude `projects/<escaped-cwd>/<id>.jsonl` vs kimi `sessions/<workDirKey>/<id>/…/wire.jsonl`) and
  the normalization path.
- `AgentAuthStatus` — the per-harness credential probe.
- `AgentPluginService` — plugins are claude-only (kimi rejects with a 400).
- `PromptRefinementService` — the harness the in-container prompt-refinement run uses.

Because it is a single global, two harnesses can't coexist in one instance, and switching needs a
redeploy. Making it per-launch has a consequence the design must handle: **the transcript layout and
the auth probe are harness-specific, so once a launch picks a harness that choice must travel with
the command**, not be re-read from a global.

## Proposed design

### 1. A generic settings backbone (new `settings` domain area)

Standard BCE, mirroring the other domain areas:

- **Entity** `QitsSetting` (`domain`, `settings.entity`) — a Panache active-record with a unique
  `key` (String) and a `value` (String / CLOB). One row per setting. Keys are dotted namespaces
  (e.g. `agent.default-type`) so unrelated settings never collide and a future UI can group them.
- **Table** `qits_setting(key PK, value, updated_at)` — a new hand-written Flyway migration
  (next is **V40**), seeding the first row `agent.default-type = <current qits.agent.type>` (so an
  existing deployment keeps its harness; a fresh install seeds `claude`).
- **Service** `SettingsService` (`settings.control`, `@ApplicationScoped`, `@Transactional`
  boundaries) — `get(key)` / `getOrDefault(key, fallback)` / `set(key, value)` (upsert) /
  `list()`, plus small typed helpers as needed. Framework-light so callers don't parse strings ad
  hoc.
- **Boundary** `SettingsController` (`service`, `settings.api`, under `/api/settings`):
  `GET /api/settings` (all), `GET /api/settings/{key}`, `PUT /api/settings/{key}` (`{value}`,
  validated). Value validation is per-key (see §2's allow-list for the agent key).

Value is a plain String; typed/enumerated settings validate on write in the service (an unknown
`agent.default-type` is a 400). A richer typed-setting schema is a follow-up, not this feature.

### 2. The default agent as the first setting

- Key `agent.default-type`, value in `{claude, kimi}` (validated against `AgentType`).
- New `AgentTypeResolver` (`domain`, `agent.control`) backed by `SettingsService`:
  `resolve(AgentType explicit)` returns `explicit` when non-null, else the parsed
  `agent.default-type` setting, else a hard-coded `CLAUDE` safety fallback. This single method is
  the **only** place precedence lives, so adding hierarchy levels later is a one-method change.
- The six `@ConfigProperty(name = "qits.agent.type")` reads are replaced:
  - `AgentLaunchService` — resolves **per launch** (explicit tab choice → default), and threads the
    resolved `AgentType` through `render*`, `AgentAuthStatus`, and `launchLogin` (all of which take
    it as a parameter instead of reading a field).
  - `AgentTranscriptService` / `AgentTranscriptTailService` — read the harness **from the command
    row** (§3), never a global, so a claude command and a kimi command in the same workspace import
    with their own layout.
  - `AgentPluginService` / `PromptRefinementService` — resolve the **default** (no per-launch
    input); behaviour is unchanged except the source moves from property to DB.
- The `qits.agent.type` property lines in `service/`/`cli/` `application.properties` are removed (or
  kept only as the migration's seed value); the harness feature's docs get a pointer here.

### 3. Recording the harness on the command

The chosen `AgentType` must survive the launch so post-hoc services resolve per-command:

- Add `Command.agentType` (nullable enum column; `null` ⇒ legacy claude) — set by
  `CommandService.launchAgent`/`launchChat` from the resolved type. Same V40 migration.
- `AgentTranscriptService.loadInfo` / `mainSession` and the tail's `locate()` read `command.agentType`
  (defaulting to claude when null) to pick `CodingAgentFactory.ofType(...)`, the config dir dot-dir
  (`.claude`/`.kimi-code`), and the normalization path — instead of the injected `agentType` field.

### 4. Two-level resolution (the hierarchy, scoped)

Precedence, highest first — **only these two sources are in scope**:

1. **The workspace-tab per-launch choice** — the "final decision" (`LaunchAgentRequest.agentType`).
2. **The qits-wide default** — the `agent.default-type` setting.

(Then the `CLAUDE` safety fallback.) `AgentTypeResolver.resolve` implements exactly this chain.
Future levels (project, repository, a persisted per-workspace preference, per-user) are **out of
scope** here; they will insert between (1) and (2) by extending the resolver's inputs — the
namespaced setting keys and the resolver signature already anticipate them.

### 5. The workspace Agents/Chat-tab agent dropdown

- `LaunchAgentRequest` (`AgentController`) gains an optional `agentType`; `AgentController.launch`
  passes it into `agentLaunchService.launchChat`/`launchInteractive` (both gain a nullable
  `AgentType` parameter that flows to `AgentTypeResolver.resolve`).
- The available agents come from a small `GET /api/agents/available` (returns the `AgentType`
  values) so the SPA doesn't hard-code the list — or, minimally, the SPA enumerates the OpenAPI
  enum.
- SPA: the Agents tab (`pattern/workspace/workspace-agent-session.component.ts`) and Chat tab
  (`pattern/workspace/workspace-chat.component.ts`) render a **dropdown** of available agents,
  defaulted to the resolved default (fetched), and include the selection in the launch mutation.
  The dropdown is disabled/annotated for a **resume** (a resumed session keeps its original
  harness — you can't resume a claude session under kimi).

### 6. The Settings SPA route

- A new lazy route `/settings` following the standard page pattern
  (`pages/settings/settings.routes.ts` + `settings.page.ts` wrapping `<app-page-layout>`), a nav
  entry in `layout/main-navigation`, and a smart `pattern/settings/` component.
- First control: a **"Default coding agent"** select (Signal Forms + a ZardUI select), reading
  `GET /api/settings/agent.default-type` and writing via `PUT` (TanStack Query mutation, invalidate
  on success). The page is generic enough that later settings render as additional fields/sections.

## Not built (candidate follow-ups)

- **More hierarchy levels** — project / repository / persisted-per-workspace / per-user overrides of
  the default agent (the resolver + key namespacing are built for it; the UI and storage are not).
- **Other settings** — the backbone is generic, but this feature ships exactly one key.
- **Typed setting schema / metadata** — validation, types, and UI hints are per-key ad hoc here; a
  declarative setting registry (type, allowed values, label, group) is a later refinement.
- **Per-launch harness for plugins / prompt-refinement** — they resolve the default only.

## Open questions / verifications

- **Auth gate vs. picker**: `AgentAuthStatus` probes per harness; selecting kimi when only claude is
  signed in must redirect to the **kimi** sign-in terminal. Confirm the resolved type reaches the
  auth gate before the login redirect decision.
- **Mixed-harness workspace**: a workspace with both a claude and a kimi command — verify the
  transcript sweep/tail of each resolves its own layout from `command.agentType` (the core reason
  §3 exists).
- **Resume across harness**: reject (or hide) a resume when the selected agent differs from the
  session's recorded harness.
- Whether the `cli` (which shares the DB) should read the default from `SettingsService` too, or
  keep a property for its standalone (no-web) commands.

## Testing / verification

- `SettingsService` unit/integration: upsert, get-or-default, list; unknown `agent.default-type`
  value rejected.
- `AgentTypeResolver`: explicit wins; else the DB default; else `CLAUDE`.
- `AgentLaunchService`: an explicit `agentType` overrides the default for chat/interactive/
  autonomous, names/auth/login follow the resolved type, and the command records it.
- Transcript import: a command with `agentType=kimi` imports the kimi layout even when the default
  setting is `claude` (and vice-versa) — the mixed-workspace guarantee.
- `SettingsController` REST tests; OpenApi export updated.
- Frontend: the Settings select round-trips the default; the workspace dropdown feeds `agentType`
  into the launch and defaults to the resolved default; disabled on resume.
