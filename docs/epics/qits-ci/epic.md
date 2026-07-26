# Epic: qits-ci — the in-repo CI pipeline as a quality gate

## Introduction

The **qits CI domain**: qits' own (proudly NIH) CI pipeline format — a config file **committed in
the repository** at `.config/qits/ci-<event>.yml`, named after the git server-side hook event that
triggers it. The first event is **`post-receive`**: when a push lands in a repo's bare origin, qits
reads the pipeline config from the pushed commit and runs its steps, each a bash script in a
container of the step's declared image. The pipeline result is the repo's **quality gate** — the
recorded green/red a branch must eventually show before it integrates.

This is deliberately distinct from [feature flows](../qits-feature-flows/epic.md): flows/actions
are **DB-configured, workspace-scoped, user-triggered** work; a CI pipeline is
**repo-committed, event-triggered** verification that travels with the code — same file-over-rows
philosophy as [config-as-single-source-of-truth](../qits-workspace-daemon/features/2026-07-24_config-as-single-source-of-truth.md).

**qits-ci is modelled as a separate service from day one** — it lives in this repository only
temporarily and **will later be extracted** into its own deployable. The architectural template is
the [qits-artifacts backbone](../qits-artifacts/epic.md): a self-contained library module (`ci/`,
depending on **neither `domain` nor `auth/*`**) with its **own named datasource + persistence unit
+ Flyway lineage**, referencing repos/branches by **string ids, never FK**, hosting its own REST
boundary that `service` merely indexes for now, and talking to the rest of qits over the same
surfaces an external service would (the git host's smart-HTTP URL, an HTTP event intake) — so the
eventual split moves files, not data, and rewires no contracts.

Related epics / cross-cutting concerns:

- **Trigger seam** — the in-process git host (`githost/GitHostRoutes`, `service` module): JGit's
  `ReceivePack` exposes exactly the `post-receive` hook point the event is named after. Pushes from
  workspace containers arrive here; the hook notifies ci over its HTTP event intake, the same wire
  contract an extracted service would receive.
- **Execution runtime** — [qits-workspaces](../qits-workspaces/epic.md)' container substrate is the
  *pattern*, not a dependency: ci shells `docker` itself (its own small executor, mirroring
  `DockerExecutor` on `qits-net`), so the runner survives extraction; the step container clones the
  pushed commit from the git host like a workspace container does.
- **In-repo config precedent** — [`.qits-config` in-repo configuration](../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md):
  the root `.qits-config.yml` is the workspace-scoped sibling; CI configs start the XDG-style
  `.config/qits/` directory (whether `.qits-config.yml` later moves in is a separate idea, not part
  of this epic).
- **Future consumers** — [qits-artifacts](../qits-artifacts/epic.md) is the natural home for step
  outputs/logs as blobs; gating [branch integration](../qits-project-repositories/epic.md) on a
  green pipeline is the follow-up that makes the gate *enforcing* rather than advisory.

## Parts, in implementation order

1. **[ci-post-receive-pipeline](features/2026-07-26_ci-post-receive-pipeline.md)** *(implemented)* — the MVP:
   the self-contained `ci/` module (own datasource/Flyway, event intake, runner), the
   `ci-post-receive.yml` format (`steps` with `script` + `image`), the `ReceivePack` post-receive
   trigger, sequential containerized step execution, and a persisted run/step status per push. No
   dependencies inside this epic.
2. **standalone-ci-service** *(future, not yet drafted)* — the extraction the module boundary is
   designed for: a small Quarkus-app module hosting the `ci` library as its own server on
   `qits-net` (alias `qits-ci`), the same lift-and-wire `standalone-artifacts-service` describes
   for artifacts. Depends on part 1.

The config format is the extension point — later parts expand it (more events, step dependencies,
caching, artifacts upload, gate enforcement) over the unchanged `steps` core.

## Done when

Rolling: a push to a repo whose pushed commit carries `.config/qits/ci-post-receive.yml` runs each
step in its declared image and records a per-step pass/fail visible for the branch — and every
subsequent CI feature lands here.

## Status

| Part | Status |
|---|---|
| [ci-post-receive-pipeline](features/2026-07-26_ci-post-receive-pipeline.md) | implemented |
| standalone-ci-service | future (not yet drafted) |
