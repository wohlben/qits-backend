# Workspace registry: connected-since + daemon build identity

## Introduction

This is Part 1 of [qits-workspace-registry](../epic.md). It generalizes the single live runtime
fact qits tracks per workspace (working-tree clean/dirty) into a small **registry** of live facts
sourced from the workspace-daemon's dial-home handshake, and adds the first two new facts:

- **Connected since** — when the workspace's daemon control socket registered.
- **Daemon build identity** — the release version + build timestamp of the daemon binary the
  running container is on.

It follows the exact contract of the clean/dirty precedent
([daemon git-status monitoring](../../qits-workspace-daemon/features/2026-07-24_daemon-git-status-monitoring.md)):
ephemeral, in-memory, known only while the container is RUNNING, re-established on each socket
(re)connect. Nothing is persisted.

Related plans: [qits-workspace-daemon epic](../../qits-workspace-daemon/epic.md) (the socket +
`Hello`/`Ack` handshake this extends), [Part 1 binary + control socket](../../qits-workspace-daemon/features/2026-07-22_workspace-daemon-binary-and-control-socket.md),
[qits-workspaces epic](../../qits-workspaces/epic.md) (`WorkspaceDto` / branch tree).

## Motivation

The daemon already dials home and announces itself with a `Hello`, but the only version signal on
the wire was a hand-bumped `DaemonProtocol.CAPABILITY_VERSION` integer that the backend merely
logged — so you could not tell **which build** of the daemon a container was running, nor **how long
it had been connected**. During active development the daemon version stays `1.0.0-SNAPSHOT` across
many builds ("floating releases"), so a version number alone can't distinguish them; a build
timestamp can. And "when did this workspace connect" is a basic operational fact the branch tree
had no way to show.

## What changed

### Daemon build identity, baked into the native binary

There was no existing pattern in the repo for surfacing the Maven version + a build timestamp at
runtime. This establishes one, scoped to the daemon module:

- `workspace-daemon/pom.xml` filters **only** `application.properties` with **`@`-delimiters**
  (`useDefaultDelimiters=false`, `<delimiter>@</delimiter>`) so `${…}` Quarkus config expressions
  are never touched. A `<timestamp>` property aliases `maven.build.timestamp` (which is not itself
  interpolable as a resource token) with format `yyyy-MM-dd'T'HH:mm:ss'Z'`.
- `application.properties` gains `qits.workspace-daemon.build.version=@project.version@` and
  `qits.workspace-daemon.build.time=@timestamp@`. Quarkus bakes config into the native image at
  build time, so the daemon reports its build identity with **no runtime file read** and no native
  resource registration.
- `ControlSocket` injects both via `@ConfigProperty` (`Optional<String>`, so an unfiltered dev jar
  still boots) and includes them in the `Hello`.

### Extended `Hello` wire contract

`Hello` gains `daemonVersion` + `daemonBuildTime` (ISO-8601 string). `DaemonProtocol.Field` +
`DaemonCodec` encode/decode them. Both are **optional on the wire** — an older daemon image that
predates the fields sends `null`, and the backend registers the connection all the same
(round-trip covered in `DaemonCodecTest`).

### In-memory registry + SPI

- `WorkspaceDaemonRegistry.DaemonConnection` gains `connectedAt` (stamped at construction, i.e. on
  `register()`), `daemonVersion`, and `daemonBuildTime` (set when the `Hello` frame is processed;
  the build-time string is parsed to an `Instant`, tolerating null/malformed — a cosmetic field
  never fails a registration).
- New framework-free `domain` SPI `WorkspaceDaemonInfo` (sibling of `WorkspaceGitStatus`) exposes
  `Optional<Info>` = `{connectedAt, version, buildTime}`, implemented by the registry;
  `Optional.empty()` when no daemon is live.

### Surfaced on `WorkspaceDto` + branch tree

- `WorkspaceDto` gains nullable `daemonConnectedAt`, `daemonVersion`, `daemonBuildTime`.
  `WorkspaceService.listWorkspaces` fills them under the same `RUNNING && isResolvable()` guard
  that already gates `clean` (via an injected `Instance<WorkspaceDaemonInfo>`, empty in cli/tests).
- `app-branch-row` renders two badges next to the clean/dirty badge: **"up since &lt;time&gt;"**
  (connected-since) and **"daemon &lt;version&gt;"** (with the build timestamp on hover, so each
  fact is a single badge). Both hidden when null.

## Contract

- Every registry fact is **RUNNING-only and in-memory**: shown only while the daemon is connected,
  gone (no badge) when the container is STOPPED, and `connectedAt` **resets on each reconnect** — it
  is "connected since", not a durable first-registered time. A qits restart self-heals within one
  socket round-trip when the daemon re-announces.
- **Backward compatible**: an older daemon image sending a `Hello` without the new fields still
  registers; its version/build badges simply don't render.

## Tests

- `DaemonCodecTest` — extended `Hello` round-trips; a `Hello` missing the build fields decodes them
  as `null`.
- `DaemonControlSocketTest` — the registry captures the announced version/build-time (parsed to an
  `Instant`) and a server-stamped `connectedAt`; `lookup` is empty for an unknown workspace.
- `branch-row.component.spec.ts` — the two badges render when reported and are absent otherwise.

## Follow-ups

Further registry facts (capability version made visible, uptime / last-heartbeat age, head drift,
running-services roll-up) are candidate later parts in the [epic](../epic.md), each following this
same seam.
