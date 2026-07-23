# Config write-back from the UI

## Introduction

Part 6 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (see the
[overview](daemon-self-provisioning-and-file-only-config.md)). With config now
[file-authoritative and workspace-scoped](config-as-single-source-of-truth.md), the configuration UI
must **write its edits into the file in the workspace** — configuring a repository *is* editing its
committed `.qits-config.yml`. This closes the loop: the UI stays a form over actions/daemons/bootstrap
steps, but the output of an edit is `/workspace/.qits-config.yml` written into the container, not a DB
row.

### Write-back mechanics (settled)

**A config edit is a working-tree write, never an auto-commit.** It surfaces as a normal uncommitted
change in the workspace, exactly like any other edit. The motivation is load-bearing: because the
workspace-daemon re-reads the file from the working tree, **you can try a changed action/daemon
definition against the live container before committing it** — edit, run, iterate, commit once it
works. Auto-committing would forfeit that try-before-commit loop and pollute history with every
experimental tweak.

### Related / dependent plans

- **Hard dependency** — [config-as-single-source-of-truth](config-as-single-source-of-truth.md) (the
  file must be authoritative before the UI edits it) and [Part 1](../features/2026-07-22_workspace-daemon-binary-and-control-socket.md).
- **Depends on the transport of [Part 3 — container-file-access-over-socket](container-file-access-over-socket.md)**
  — the daemon's `WriteFile`/`ReadFile` verbs are how the UI's edit reaches `/workspace/.qits-config.yml`
  (and how the current file is read back for the form). This part supplies the *config-editing* use
  of that transport.
- **Realizes the [`.qits-config` feature's "Config scaffolding / export" follow-up](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md#follow-ups-not-v1)**
  as the **core mechanism**, not a nicety — the UI serializes the form to YAML and writes it.

## What this adds

- **Read-for-edit** — the config forms load the current `/workspace/.qits-config.yml` (via the
  daemon file-read verb / the [in-container config view](in-container-config-discovery.md)), populate
  the form, and on save **re-serialize the whole file** (or the edited section) and write it back to
  the working tree.
- **The UI surfaces that flip from read-only to editing** (they currently render a `.qits-config`
  badge + suppressed edit affordance via `shared/utils/config-origin.ts`):
  - `ui/components/action-configuration/action-configuration-card.component.ts` + the
    `pattern/action-configuration/` create/update form.
  - `ui/components/daemon/repository-daemon-card.component.ts` + `pattern/daemon/` form +
    `pages/repositories/repository-daemons/`.
  - `ui/components/bootstrap/bootstrap-command-card.component.ts` + `pattern/bootstrap/` form +
    `pages/repositories/repository-bootstrap/`.
  - The now workspace-scoped surfacing moves these under the **workspace-detail** view (config is
    per-workspace), not repo-detail (which lost its config sections in
    [Part 5](config-as-single-source-of-truth.md)).
- **YAML (de)serialization contract** — round-trip stability: the written file must re-parse to the
  same config the daemon reads; preserve key order and the `version: 1` discriminator; ids are
  explicit and preserved on edit (per the Part-5 id decision).

## Non-goals

- Auto-commit — deliberately excluded (working-tree write only; see mechanics above).
- Comment/format preservation of hand-authored YAML beyond a stable canonical serialization (a
  round-trip may reflow the file; acceptable for a first cut).
- The file transport itself — [Part 3](container-file-access-over-socket.md) owns `WriteFile`/`ReadFile`.

## Testing

- **Round-trip** — a UI edit writes the file, the daemon re-reads it, and the workspace's config view
  reflects the change with no commit (the working tree shows the edit as dirty).
- **Try-before-commit** — edit a daemon's `start`, re-run it against the live container, confirm the
  new definition takes effect before any commit.
- **UI** — the config cards/forms are editable under workspace-detail; screenshot/browser coverage
  for the flipped affordance; regenerate both `openapi.yml` copies if the API surface changes.
