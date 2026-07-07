# Agent LSP plugins — install Claude Code LSP plugins per workspace

## Introduction

The coding agent (Claude Code) runs inside every workspace container. Claude Code's plugin system can
wire in language servers (LSP) — `jdtls-lsp` (Java) and `typescript-lsp` (TypeScript/Angular) from the
pre-registered `claude-plugins-official` marketplace — which sharpens the agent's code-navigation on
the frameworks a repo actually uses. This feature adds a **Plugins** tab to the workspace detail
route: a curated list of preconfigured LSP plugins, each showing installed status (green/amber/muted)
with an **Install** button when missing, and framework-recommended plugins floated to the top.

Related / dependent plans:

- Sits on the [coding-agent harness](2026-07-01_coding-agent-harness.md): plugins are read by the same
  `claude` binary that `ClaudeCodeAgent` launches, from the shared credential volume.
- Reuses the container/volume model of [workspace containers](2026-07-04_workspace-containers.md): the
  agent's `HOME` is the shared `qits.workspace.claude-volume` (default `qits_shared_dot_claude`)
  mounted at `qits.workspace.claude-mount` (default `/claude-home`) — see
  `docker/workspace/agent-login.sh`. The list/install ops route through `ContainerRuntime.exec` with
  `HOME` on that mount, exactly like [`AgentAuthStatus`](2026-07-04_container-agent-sessions.md).
- Uses the frontend framework detection of the
  [framework-aware file browser](2026-07-03_framework-aware-file-browser.md)
  (`shared/utils/detect-frameworks.ts`) to *recommend/highlight* which plugins a given workspace wants,
  without hiding the rest — per the "everything available, surfaced by visible rules" principle.
- New tab on the workspace detail page
  (`pages/repositories/workspace-detail/workspace-detail.page.ts`), alongside the existing
  `z-tab-group` (Files / Events / Telemetry).

## The key constraint: the plugin store is global (the shared volume)

Claude Code discovers plugins under its config dir (`$CLAUDE_CONFIG_DIR`, which
`WorkspaceContainerFactory` sets to `/claude-home/.claude` on every container). At runtime every
workspace container is launched with that shared credential volume mounted, so:

- **Installs are global, not per-workspace.** Installing a plugin from workspace A writes to
  `/claude-home/.claude`, which workspaces B, C, D all see.
- **Status is a property of the shared volume**, identical in every workspace's tab. A red→green flip
  in one repo turns the plugin green everywhere.

This is intentional and matches how credentials already work (install once, every container benefits).
Plugins are additive — an idle `jdtls-lsp` does nothing in an Angular repo — so a global store causes
no harm. The **per-repository** angle is served not by isolating the store but by using framework
detection to surface/sort the plugins a repo actually wants. (A true per-workspace store via
`claude --plugin-dir <path>` threaded through `ClaudeCodeAgent` was considered and rejected as
over-engineered for the payoff; parked below.)

This kills the naive "just add `claude plugin install` to the Dockerfile" approach: the image's
build-time `HOME=/workspace`, and `/claude-home` is a named volume that shadows any image content at
that path — so a baked-in plugin lands where runtime-claude never looks.

## What was built

### 1. LSP binaries baked into the image (`docker/workspace/Dockerfile`)

The LSP plugins only *wire up* a language server on `PATH`; they do **not** bundle it. So the binaries
are part of the common toolchain and live in the image (next to the JDK/Node it already carries):

- `typescript-language-server` + `typescript` — `npm install -g` (Node/pnpm already present); this is
  the plugin's own documented recipe.
- `jdtls` (Eclipse JDT language server) — download + unpack the distribution under `/opt/jdtls` and
  symlink its `bin/jdtls` python launcher onto `PATH` (JDK 25 already present). Pinned via a
  `JDTLS_URL` build arg (defaults to the snapshot tarball); the build asserts `bin/jdtls` exists so a
  distribution-structure change fails loudly at build time rather than at agent runtime.

These are `HOME`-independent, so the Dockerfile is the correct home for them (unlike the plugins).

### 2. Curated plugin registry (frontend)

`pattern/workspace/agent-plugin-registry.ts` — a small static list, each entry: stable id
(`jdtls-lsp`, `typescript-lsp`), marketplace (`claude-plugins-official`), display label, description,
and the framework id(s) it serves (`java-quarkus`, `ts-angular`) so the tab can highlight/sort by the
workspace's detected frameworks (`detectFrameworks(paths)`). All entries are shown; detected-framework
matches float to the top and get a "Recommended" badge.

### 3. Backend: list + install against the shared volume

`domain/agent/control/AgentPluginService` (+ `domain/agent/dto/InstalledPluginDto`), routed through
`ContainerRuntime.exec` with `HOME=/claude-home`, exactly like every other workspace op:

- **List installed** — `cat`s `/claude-home/.claude/settings.json` and parses its `enabledPlugins`
  object: keys are marketplace-qualified ids (`jdtls-lsp@claude-plugins-official`), values are booleans
  (`true` = enabled, `false` = installed-but-disabled, **absent** = not installed). Claude-binary and
  auth free — just stat + JSON-parse a file on the volume. A missing file (nothing ever installed) /
  malformed JSON reads as an empty list, never a 500 (the settings schema is undocumented, so shape
  drift is tolerated).
- **Install** — `claude plugin install <id>@claude-plugins-official` (non-interactive; the official
  marketplace is pre-registered, no `marketplace add` step). Idempotent. Returns the refreshed
  installed set so the caller reflects the flip without a second round trip.

Endpoints hang off the workspace (any workspace can act on the global store), on
`service/…/agent/api/AgentPluginController`:
`GET  /api/repositories/{repoId}/workspaces/{workspaceId}/agent-plugins` (list) and
`POST /api/repositories/{repoId}/workspaces/{workspaceId}/agent-plugins/{pluginId}/install`. The repo
id (UUID), workspace id (slug) and bare plugin id (lowercase slug) are validated before any container
work, so bad input is a fast 400.

### 4. Plugins tab (frontend)

`pattern/workspace/workspace-plugins.component.ts` — a new `z-tab label="Plugins"` on the workspace
detail page rendering the registry joined with backend status. Each row shows a status chip
(`ui/components/agent/plugin-status-chip.component.ts`: green *Installed* / amber *Disabled* / muted
*Not installed*) and an **Install** button when available. The button POSTs then invalidates the
status query (per-row spinner via the mutation's pending variable). Framework detection reuses the file
browser's file-listing query (same key + shape → one cache entry). Because the store is global, an
install elsewhere may already show green here — acceptable and honest given the shared-store semantics.

## Verified against the live marketplace / plugins

- **Plugin ids** — `jdtls-lsp` and `typescript-lsp` under marketplace `claude-plugins-official`,
  confirmed against `anthropics/claude-plugins-official` and the plugins' own READMEs.
- **Binary recipes** — the plugin READMEs pin exactly these: `npm install -g typescript-language-server
  typescript`, and for `jdtls-lsp` a `jdtls` launcher on `PATH` from the Eclipse JDT.LS distribution
  (needs a JDK ≥ 17 — the image ships 25).

## Open items to verify on first real run (need docker + a signed-in volume)

- **`enabledPlugins` shape** — the parser reads `enabledPlugins` as `{ "<id>@<marketplace>": bool }`;
  confirm the object name/shape empirically once against a real installed volume. The parser tolerates
  drift (empty on mismatch) rather than failing, so a wrong guess degrades to "nothing installed", not
  a crash.
- **`claude plugin install` exit semantics** — the install op treats non-zero as failure and assumes
  idempotency; confirm both by running it twice in a throwaway container.

## Testing

- `AgentPluginServiceTest` — pure `parseEnabledPlugins` tests (enabled/disabled join, absent object,
  blank/missing file, malformed JSON → empty).
- `AgentPluginControllerTest` (`@QuarkusTest`) — endpoint wiring + validation: non-UUID repo id and
  malformed plugin id are rejected before any container work (proves wiring without docker/claude).
- `workspace-plugins.component.spec.ts` — registry render, status join (installed/disabled/available),
  framework-recommended sorting + badge, and the install click POSTing the bare id.
- `workspace-detail.page.spec.ts` — updated for the fourth tab.
- `docs/openapi.yml` regenerated (`OpenApiSchemaExportTest`) and the Angular client regenerated
  (`pnpm generate:api`); `ng build` + `ng lint` clean; full `./mvnw clean install` green.

## Parked alternative: per-workspace plugin isolation

Give each workspace its own plugin dir and pass `claude --plugin-dir <per-workspace-path>` at launch
(ClaudeCodeAgent already builds the command line; credentials stay on the shared volume). Yields true
per-repo status but adds per-workspace storage, a launch-flag change, and threads a session-scoped flag
through every launch. **Trigger to pick up:** if global-store semantics prove confusing in practice, or
a plugin turns out to have per-repo side effects that make a shared store harmful.

## Backlog follow-up: binary-presence status

v1 treats "plugin installed" (present in `enabledPlugins`) as the status. Since the language-server
binary is always baked into the image, this is sufficient. A future two-part status (binary on `PATH`
**and** plugin installed) would catch a drifted image where the plugin is enabled but its binary is
missing — parked until image drift is observed in practice.
