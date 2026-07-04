-- Durable classified daemon events: observer findings and supervisor transitions survive the JVM
-- (previously a 500-entry in-memory ring). Snapshot columns throughout — command_id is a plain
-- column, not an FK, so deleting a command keeps its events inspectable. The anchor columns locate
-- the excerpt in its source: command_log_line sequences for source='output', 1-based line numbers
-- since source_epoch for a tailed file (whose lines are deliberately not copied into the DB).

create table daemon_event (
  id varchar(255) not null,
  repo_id varchar(255) not null,
  worktree_id varchar(255) not null,
  daemon_id varchar(255) not null,
  daemon_name varchar(255) not null,
  kind varchar(255) not null check (kind in ('STATUS_CHANGED','ERROR_DETECTED')),
  severity varchar(255) check (severity in ('INFO','WARNING','ERROR')),
  status varchar(255) check (status in ('STARTING','READY','DEGRADED','RESTARTING','CRASHED','STOPPED')),
  summary varchar(2000),
  log_excerpt clob,
  command_id varchar(255),
  source varchar(1024),
  anchor_from bigint,
  anchor_to bigint,
  source_epoch timestamp(6) with time zone,
  at timestamp(6) with time zone not null,
  primary key (id)
);

create index idx_daemon_event_worktree on daemon_event (repo_id, worktree_id, at desc);
