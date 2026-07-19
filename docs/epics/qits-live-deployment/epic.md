# Epic: qits-live-deployment — running qits as a deployed service

## Introduction

The **deployment/runtime domain**: the concerns of running qits as a real, deployed service
rather than a dev-server — Kubernetes-compatible health probes, the shared Docker network that
lets qits reach its workspace containers (and itself run in a container), and the packaged
instance self-registering the qits repositories at startup. The durable operator how-to lives
in `docs/guides/deployment.md`; this epic is the *feature history* of what makes a live
deployment work.

**Cross-cutting operations epic**, not part of the projects → repositories → workspaces
aggregate chain. Retroactive umbrella epic; future deployment/ops features land here.

Related epics / cross-cutting concerns:

- **qits-in-qits** — [qits-integration-quarkus](../qits-integration-quarkus/epic.md): the
  startup self-seed automates the manual `qits-in-qits-registration` walk, so a packaged qits
  boots as a managed app of itself (dogfooding).
- **The network is why qits runs containerized** — the `qits-net` unification is what lets the
  [daemon web view](../qits-workspace-detail/epic.md) /
  [workspace containers](../qits-workspaces/epic.md) reach a container's ports by DNS name with
  no host-port publishing; `GitHostResolver`/the `qits` alias for container→qits git/OTLP/MCP
  ride the same network.
- **Not daemon healthchecks** — this epic's `health-checks` are SmallRye probes for the **qits
  service itself** (`/q/health/*`); the per-dev-server probes in
  [qits-workspace-daemons](../qits-workspace-daemons/epic.md) are a different, unrelated
  mechanism (they merely reuse a `/q/health` endpoint as a convenient target).

## Parts (implemented)

- **[health-checks](features/2026-05-01_health-checks.md)** (05-01) — SmallRye
  Kubernetes-compatible liveness/readiness probes (`/q/health/live`, `/q/health/ready`,
  `/q/health`) for the qits service.
- **[qits-net-devcontainer-unification](features/2026-07-07_qits-net-devcontainer-unification.md)**
  (07-07) — one shared Docker network (`qits-net`) for qits and every workspace container, so
  qits reaches a container's ports by DNS name (no host-port publishing) — which is why qits
  itself runs in a container via the `.devcontainer/`.
- **[startup-qits-self-seed](features/2026-07-19_startup-qits-self-seed.md)** (07-19) — a
  packaged deployment registers the qits repositories **itself** at startup (the automated form
  of the manual registration walk), booting into a seeded "qits" project.

## Done when

Rolling: current when its `feature-ideas/` is empty and every deployment/ops feature since this
epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [health-checks](features/2026-05-01_health-checks.md) | implemented |
| [qits-net-devcontainer-unification](features/2026-07-07_qits-net-devcontainer-unification.md) | implemented |
| [startup-qits-self-seed](features/2026-07-19_startup-qits-self-seed.md) | implemented |
