# Container file access over the `clientd` socket (replace `docker exec cat`/`tar`)

## Introduction

Part 3 of [qits-workspace-client](../epic.md). **Out of scope until
[Part 1](clientd-binary-and-control-socket.md) lands.** Moves reading and writing files in
`/workspace` off the host `docker exec` shell and onto the control socket: qits sends
`ReadFile`/`WriteFile`/`ListDir` messages and `clientd` performs the I/O in-container.

> **Reframing the umbrella idea's "docker copy".** The original sketch said the socket would
> replace `docker cp`. There is **no `docker cp`** in the codebase — file transfer is done with
> `docker exec cat`/`tar` via `ContainerFileAccess`. This part replaces that real surface.

Related/dependent plans:

- **Hard dependency** — [Part 1](clientd-binary-and-control-socket.md) (socket + envelope).
- **Sibling of** [Part 2](command-execution-over-socket.md) — file access and command execution
  are the two generic in-container primitives; order is independent but Part 2 is the bigger win
  so it goes first.
- **Consumes/relates to**
  [container file access](../../qits-workspaces/features/2026-07-04_container-file-access.md) —
  the feature whose `ContainerFileAccess` implementation this part re-homes.

## The current surface (what moves)

- **`ContainerFileAccess`** (`domain/.../repository/control/ContainerFileAccess.java`) — reads and
  writes workspace files by shelling `containers.exec(... "cat"/"tar" ...)`. Every consumer (the
  detail UI's file views, capture/snapshot handling, config reads) goes through it.

## Scope

- Add `ReadFile { path }` → `FileContent { bytes, eof }` (chunked for large files),
  `WriteFile { path, bytes, mode }` → `Ack`, and `ListDir { path }` → `DirListing` to the
  envelope.
- Reimplement `ContainerFileAccess` against the socket when a client is live; **fall back to
  `docker exec`** otherwise (degradation contract) until exec verbs are retired.
- Preserve path sandboxing to `/workspace` and the existing size/encoding handling.

## Out of scope

- Command execution (Part 2), git (Part 4), daemons (Part 5), MCP (Part 6).

## Testing

- Round-trip read/write/list against a fake client peer; regression on the existing
  file-access-backed features (detail file views, captures).
