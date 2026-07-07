# Agent LSP plugins — install Claude Code LSP plugins per workspace

## Introduction

The coding agent (Claude Code) runs inside every workspace container. Claude Code's plugin system can
wire in language servers (LSP) — e.g. `jdtls-lsp` (Java) and `typescript-lsp` (TypeScript/Angular)
from the pre-registered `claude-plugins-official` marketplace — which sharpens the agent's
code-navigation on the frameworks a repo actually uses. This idea adds a **Plugins** tab to the
workspace detail route: a curated list of preconfigured LSP plugins, each showing installed status
(green/red) with an **Install** button when missing.

Related / dependent plans:

- Sits on the [coding-agent harness](../features/2026-07-01_coding-agent-harness.md): plugins are
  read by the same `claude` binary that `ClaudeCodeAgent` launches, from the shared credential volume.
- Reuses the container/volume model of
  [workspace containers](../features/2026-07-04_workspace-containers.md): the agent's `HOME` is the
  shared `qits.workspace.claude-volume` (default `qits_shared_dot_claude`) mounted at
  `qits.workspace.claude-mount` (default `/claude-home`) — see `docker/workspace/agent-login.sh`.
- Depends on [resolved: workspace-image JAVA_HOME unset](../issues/resolved/2026-07-07_workspace-image-java-home-unset.md):
  `jdtls-lsp` needs `JAVA_HOME` to launch, which the base image now sets.
- Uses the frontend framework detection of the
  [framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md)
  (`shared/utils/detect-frameworks.ts`) to *recommend/highlight* which plugins a given workspace wants,
  without hiding the rest — per the "everything available, hidden by visible rules" principle.
- New tab on the workspace detail page
  (`pages/repositories/workspace-detail/workspace-detail.page.ts`), alongside the existing
  `z-tab-group` (Files / Events / Telemetry).

## The key constraint: the plugin store is global (the shared volume)

Claude Code discovers plugins under `$HOME/.claude/plugins/`, resolved from `$HOME`. At runtime every
workspace container is launched with `HOME=/claude-home`, the **single shared credential volume**
mounted into all of them (the same volume that carries the operator's one-time OAuth login). Therefore:

- **Installs are global, not per-workspace.** Installing a plugin from workspace A writes to
  `/claude-home/.claude/plugins`, which workspaces B, C, D all see.
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

## What was built (proposed)

### 1. LSP binaries baked into the image (`docker/workspace/Dockerfile`)

The LSP plugins only *wire up* a language server on `PATH`; they do **not** bundle it. So the binaries
are part of the common toolchain and belong in the image (next to the JDK/Node it already carries):

- `typescript-language-server` + `typescript` — `npm install -g` (Node/pnpm already present).
- `jdtls` (Eclipse JDT language server) — download + unpack (JDK 25 already present; `JAVA_HOME` is
  now set too — jdtls needs it — see
  [resolved: workspace-image JAVA_HOME unset](../issues/resolved/2026-07-07_workspace-image-java-home-unset.md)).

These are `HOME`-independent, so the Dockerfile is the correct home for them (unlike the plugins).

### 2. Curated plugin registry (frontend)

A small static list of preconfigured plugins, each: stable id (`jdtls-lsp`, `typescript-lsp`, …),
marketplace (`claude-plugins-official`), display label, and the framework id(s) it serves
(`java-quarkus`, `ts-angular`) so the tab can highlight/sort by the workspace's detected frameworks
(`detectFrameworks(paths)`). Show **all** entries; float detected-framework matches to the top.

### 3. Backend: list + install against the shared volume

Two container operations, routed through `ContainerRuntime`/`CommandService` like every other workspace
op, run with `HOME=/claude-home` and the credential volume mounted:

- **List installed** — read `/claude-home/.claude/settings.json` and parse its `enabledPlugins` object:
  keys are marketplace-qualified ids (`jdtls-lsp@claude-plugins-official`), values are booleans
  (`true` = enabled, `false` = installed-but-disabled, **absent** = not installed). This is
  claude-binary/auth-free — just stat + JSON-parse a file on the volume. (Equivalent alternative:
  `claude plugin list --json` / `--json --available`, but that invokes the binary per poll.) Note the
  three states: the tab should distinguish **not installed** (absent) from **installed** (present),
  and can optionally treat `false` as installed-but-disabled.
- **Install** — `claude plugin install <id>@claude-plugins-official` (non-interactive; the official
  marketplace is pre-registered, no `marketplace add` step). Run with `HOME=/claude-home` so it writes
  to the shared volume's `enabledPlugins`.

Endpoints hang off the workspace (any workspace can act on the global store), e.g.
`GET  /api/.../workspaces/{id}/agent-plugins` (list + status) and
`POST /api/.../workspaces/{id}/agent-plugins/{pluginId}/install`.

### 4. Plugins tab (frontend)

A new `z-tab label="Plugins"` on the workspace detail page rendering the registry joined with backend
status: `[green] Java LSP  installed` / `[red] TypeScript LSP  [ Install ]`. Install button POSTs,
then refetches status. Because the store is global, an install elsewhere may already show green here —
acceptable and honest given the shared-store semantics stated above.

## Open questions / to verify before implementing

- **Installed-status detection.** *(resolved)* Parse `enabledPlugins` in
  `/claude-home/.claude/settings.json` (key = `<id>@<marketplace>`, value = enabled bool; absent = not
  installed). Claude-binary-free. `claude plugin list --json` is the equivalent binary-backed form. The
  exact settings JSON schema isn't documented, so confirm the object name/shape empirically once against
  a real volume before wiring the parser.
- **Install exit semantics.** *(undocumented — verify empirically)* Confirm `claude plugin install`
  exits non-zero on failure / zero on success and is idempotent when the plugin is already installed.
  Run it twice in a throwaway container and check `$?`.
- **Plugin ids.** Confirm the exact ids `jdtls-lsp` / `typescript-lsp` and jdtls install recipe against
  the live `claude-plugins-official` marketplace before writing the Dockerfile/registry lines.
- **Binary presence vs plugin installed.** v1 treats "plugin installed" as the status. Since the binary
  is always baked into the image, this is sufficient; a future two-part status (binary on `PATH` **and**
  plugin installed) would catch a drifted image.

## Parked alternative: per-workspace plugin isolation

Give each workspace its own plugin dir and pass `claude --plugin-dir <per-workspace-path>` at launch
(ClaudeCodeAgent already builds the command line; credentials stay on the shared volume). Yields true
per-repo status but adds per-workspace storage, a launch-flag change, and threads a session-scoped flag
through every launch. **Trigger to pick up:** if global-store semantics prove confusing in practice, or
a plugin turns out to have per-repo side effects that make a shared store harmful.
