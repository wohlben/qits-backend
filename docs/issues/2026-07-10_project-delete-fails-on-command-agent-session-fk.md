# Project/repository delete fails on the `command_agent_session` FK (no cascade)

## Introduction

Found while running the `seed-webapp` reset during verification of
[daemon-healthchecks](../features/2026-07-10_daemon-healthchecks.md) — unrelated to that feature.
Introduced by [chat persistence on the transcript channel](../features/) (V28, commit `6640fea`).
Related: `V10__worktree_history.sql` (which established the cascade convention this FK missed).

## Observed

`./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp` against a dev database whose demo project had
an agent session fails during the idempotent reset:

```
Referential integrity constraint violation:
  "FK_COMMAND_AGENT_SESSION_COMMAND: PUBLIC.COMMAND_AGENT_SESSION
   FOREIGN KEY(COMMAND_ID) REFERENCES PUBLIC.COMMAND(ID) (...)"
  at eu.wohlben.qits.cli.SeedWebappService.lambda$seed$1(SeedWebappService.java:119)
```

Any `ProjectService.delete` / `RepositoryService.delete` (REST `DELETE /api/projects/{id}` too)
hits the same wall once one of the repository's commands has a persisted agent session — i.e.
after the workspace agent chat has been used at all.

## Suspected cause

`RepositoryService.delete` relies on DB-level cascades for the repository's commands ("DB rows for
workspaces/commands/events/daemons cascade off the repository row deletion below",
`RepositoryService.java:385`). `V10__worktree_history.sql` deliberately rebuilt the `command`
child FKs with `on delete cascade` for exactly this reason, and later child tables followed
(`agent_session_stat` in `V30__agent_session_stat.sql:20`). But
`V28__command_agent_session.sql:21` declares

```sql
foreign key (command_id) references command;
```

— no `on delete cascade` — so deleting a `command` row with agent-session rows violates the FK.
The `@ElementCollection` on `Command` only cascades for entity-manager deletes, not for the
cascade-off-the-repository-row path.

## Suggested fix direction

A `V32` migration mirroring V10's repair:

```sql
alter table command_agent_session drop constraint if exists FK_command_agent_session_command;
alter table command_agent_session add constraint FK_command_agent_session_command
  foreign key (command_id) references command on delete cascade;
```

Plus a regression test: delete a repository/project whose command carries an agent session row
(e.g. extend the seed/agent-session tests, which currently never delete after chatting).
