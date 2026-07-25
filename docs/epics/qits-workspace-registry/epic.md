# Epic: qits-workspace-registry — richer live runtime info per workspace

## Introduction

qits already tracks one live runtime fact about a workspace: whether its in-container working tree
is **clean or dirty**, reported by the workspace-daemon over its control socket and surfaced as a
badge in the branch tree (`WorkspaceDto.clean`). This epic generalizes that single fact into a
**workspace registry** — a growing set of live, per-workspace runtime facts sourced from the
daemon's dial-home handshake and surfaced the same way. It is deliberately incremental: each part
adds facts to the registry record and its badges, never changing the ephemeral, RUNNING-only,
in-memory contract that clean/dirty already established.

Related / dependent plans:

- **Builds on [qits-workspace-daemon](../qits-workspace-daemon/epic.md)** — the registry is fed by
  the daemon's `Hello` handshake and lives on `WorkspaceDaemonRegistry`, the backend's in-memory
  live-daemon directory the daemon epic introduced. This epic extends the `Hello` wire contract and
  the registry's per-connection state; it does not change the socket lifecycle.
- **Extends [qits-workspaces](../qits-workspaces/epic.md)** — `WorkspaceDto` / `WorkspaceService`
  / the branch tree are where the registry facts are read and shown, alongside `runtimeStatus` and
  `clean`.
- **Consumes the clean/dirty precedent** — [daemon git-status
  monitoring](../qits-workspace-daemon/features/2026-07-24_daemon-git-status-monitoring.md) is the
  reference for the RUNNING-only, in-memory, re-reported-on-reconnect contract every registry fact
  follows.

## Terminology

- **Registry fact** — a live runtime attribute of a workspace, known only while its daemon is
  connected (the container is RUNNING), held in-memory on `WorkspaceDaemonRegistry`, re-established
  on each socket (re)connect, and surfaced as a nullable field on `WorkspaceDto` (null ⇒ unknown ⇒
  no badge). Clean/dirty is the first; this epic adds more.
- **Connected since** — when a workspace's daemon control socket registered. Server-stamped on
  registration; resets on each reconnect (it is "connected since", not a durable first-registered
  time).
- **Daemon build identity** — the daemon binary's own release version + build timestamp, baked into
  the native image at build time and announced in the `Hello`. Distinguishes numbered releases (by
  version) and floating `-SNAPSHOT` builds (by timestamp) while the version number is still
  settling.

## Scope rule

This epic owns **the set of live per-workspace runtime facts sourced from the daemon handshake, the
`Hello` fields that carry them, their in-memory home on `WorkspaceDaemonRegistry`, the
framework-free `domain` SPI(s) that expose them, their `WorkspaceDto` fields, and their branch-tree
badges.** It does **not** own the daemon's socket lifecycle (that's qits-workspace-daemon) or
persist anything — every registry fact is ephemeral, matching clean/dirty. A fact that needs to
survive a backend restart or be shown for a STOPPED workspace is out of scope until a part
explicitly introduces persistence.

## Parts (implementation order)

### Part 1 — connected-since + daemon build identity (IMPLEMENTED)

- **[workspace-daemon-registry-info](features/2026-07-25_workspace-daemon-registry-info.md)**
  (**implemented 2026-07-25**) — bakes the daemon binary's build version + timestamp into the
  native image, carries them plus a server-stamped "connected since" up through an extended `Hello`,
  holds them in-memory on `WorkspaceDaemonRegistry` behind a new `WorkspaceDaemonInfo` SPI, surfaces
  them as three nullable `WorkspaceDto` fields, and renders them as two badges next to the
  clean/dirty badge in the branch tree.

### Part 2 — outdated-daemon warning + recreate workspace (IMPLEMENTED)

- **[outdated-daemon-warning-recreate](features/2026-07-25_outdated-daemon-warning-recreate.md)**
  (**implemented 2026-07-25**) — the first part to make a registry fact *actionable*. Adds an
  enumeration seam (`WorkspaceDaemonInfo.all()`) so the backend can derive, from the registry alone,
  the newest daemon build currently connected; flags any workspace running a strictly-older build via
  a new nullable `WorkspaceDto.daemonOutdated`; turns the Part 1 version badge into a warning; and
  offers a **Recreate workspace** action (`POST .../recreate-container`) that tears the container down
  and re-provisions it on the current image (the newer daemon). Recreate is gated CLEAN-only and
  re-verified server-side — dirty **and** unknown are both rejected. Persists nothing, RUNNING-only,
  matching the epic contract.

### Later parts (OUT OF SCOPE until proposed — each its own feature-idea)

Candidate registry facts the same seam can carry (not yet specced): the daemon's capability version
made user-visible, in-container resource/liveness signals (uptime, last-heartbeat age), the current
head/branch drift, the running services roll-up. Each would be a new `Hello`/event field, a new
`WorkspaceDaemonInfo` (or sibling SPI) fact, a `WorkspaceDto` field, and a badge — following Part 1.

## Status

- Part 1 — **done** (2026-07-25).
- Part 2 — **done** (2026-07-25).
