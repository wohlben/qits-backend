# RESOLVED: Coding-agent chat "thinking" forever — `setsid` tears down docker-exec stdin

## Introduction

Related / dependent plans:

- `docs/features/2026-07-04_container-agent-sessions.md` — the stream-json chat over a container `docker exec` pipe.
- `docs/features/2026-07-04_workspace-containers.md` — the per-worktree container execution model and the `CommandRegistry` spawn seams.
- `docs/issues/2026-07-05_agent-mcp-unreachable-from-container.md` — a **separate** bug surfaced while diagnosing this one (the agent's MCP server is unreachable from the container).

## Symptom

Sending a message to the coding agent (e.g. from the project detail route) switches the UI to
"Claude is thinking" but no response ever arrives. The login REPL and one-off `claude -p` calls work
fine; only the stream-json **chat** hangs.

## Root cause

The no-TTY spawn path (`CommandRegistry.dockerExec`, used by `spawnChat`) wrapped the launch in
`setsid bash -lc "echo $$ > pid; exec claude …"`. `setsid` (without `-w`) double-forks and its parent
exits immediately. Under `docker exec -i`, when that direct child exits, docker considers the exec
finished and **tears down the stdin/stdout pipes** — even though the detached `claude` grandchild is
still running. Claude then reads **EOF on stdin before the first user turn arrives** and exits `0`
without ever answering (sometimes after emitting only its `system/init` line). The chat command shows
`EXITED exit=0` while the UI still shows "thinking".

`setsid` was there so `kill -- -pgid` can address the shell's process group on the pipe path (the
`-it` path doesn't need it — docker makes the shell a session leader). But plain `setsid` is
incompatible with keeping the exec's pipes open.

Reproduced live in a worktree container (A/B, identical command otherwise):

- `bash -lc "exec claude --print --input-format stream-json …"` → responds (`result` emitted).
- `setsid bash -lc "…"` → 0 output lines, exit 0, no response.
- `setsid -w bash -lc "…"` → responds.

And end-to-end through the qits API after the fix: a `PROJECT`-scope chat returned its assistant
message + a successful `result`.

## Fix

`domain/.../command/control/CommandRegistry.java` `dockerExec(...)`: the no-TTY path now emits
`setsid -w` (wait for the child) instead of `setsid`. `-w` keeps the exec's direct child alive for
the whole session, so `docker exec -i` leaves stdin/stdout connected and claude reads its turns
normally. Process-group kill semantics are unchanged: `$$` still records the shell (→ claude via
`exec`) as the session/group leader, and `setsid -w` sits outside that group, so `kill -- -pgid` still
terminates claude and `setsid -w` then reaps it.

## Verification

Live A/B reproduction (above) plus an end-to-end `PROJECT` chat via
`POST /api/repositories/{repoId}/worktrees/{worktreeId}/agents` observed over the chat websocket
returning `result.is_error=false`.

No unit test added: the affected path is a private `docker exec` argv builder that `FakeContainerRuntime`
(host processes, no `setsid`/`docker exec`) does not exercise; only a real-docker + real-`claude` +
stream-json-timing IT would catch it. The fix is verified live.
