-- Ordered per-daemon healthchecks: named HTTP/TCP/COMMAND probes the supervisor runs on an
-- interval inside the workspace container. Definition only — probe results are runtime-only
-- (latest per check, cached in the supervisor) and never persisted, so this is the whole schema.
-- Same element-collection split as repository_daemon_observer / repository_daemon_source.

create table repository_daemon_healthcheck (
  repository_daemon_id varchar(255) not null,
  healthcheck_index integer not null,
  name varchar(255) not null,
  kind varchar(255) not null check (kind in ('HTTP','TCP','COMMAND')),
  port integer,
  path varchar(500),
  expect_status varchar(100),
  command varchar(4000),
  interval_ms bigint,
  timeout_ms bigint,
  healthy_threshold integer,
  unhealthy_threshold integer,
  initial_delay_ms bigint,
  primary key (repository_daemon_id, healthcheck_index)
);
alter table repository_daemon_healthcheck
  add constraint FK_repository_daemon_healthcheck_daemon
  foreign key (repository_daemon_id) references repository_daemon (id);
