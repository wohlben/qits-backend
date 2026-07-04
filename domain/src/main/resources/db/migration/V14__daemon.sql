-- Daemons: managed long-running processes (definition tables) + the DAEMON command kind.
-- Definitions mirror the action split: a global library table and a repository-owned table with
-- identical columns, each with its own env map and ordered observer list (element collections).

create table daemon_configuration (
  id varchar(255) not null,
  name varchar(255) not null,
  description varchar(255),
  start_script varchar(4000) not null,
  ready_pattern varchar(500),
  stop_signal varchar(32) not null,
  restart_policy varchar(255) not null check (restart_policy in ('NEVER','ON_FAILURE','ALWAYS')),
  max_restarts integer not null,
  created_at timestamp(6) with time zone not null,
  updated_at timestamp(6) with time zone not null,
  primary key (id)
);

create table daemon_configuration_env (
  daemon_configuration_id varchar(255) not null,
  env_value varchar(2000),
  env_key varchar(255) not null,
  primary key (daemon_configuration_id, env_key)
);
alter table daemon_configuration_env
  add constraint FK_daemon_configuration_env_daemon
  foreign key (daemon_configuration_id) references daemon_configuration (id);

create table daemon_configuration_observer (
  daemon_configuration_id varchar(255) not null,
  observer_index integer not null,
  kind varchar(255) not null check (kind in ('PATTERN','MODEL')),
  pattern varchar(500),
  severity varchar(255) check (severity in ('INFO','WARNING','ERROR')),
  prompt varchar(4000),
  primary key (daemon_configuration_id, observer_index)
);
alter table daemon_configuration_observer
  add constraint FK_daemon_configuration_observer_daemon
  foreign key (daemon_configuration_id) references daemon_configuration (id);

create table repository_daemon (
  id varchar(255) not null,
  name varchar(255) not null,
  description varchar(255),
  start_script varchar(4000) not null,
  ready_pattern varchar(500),
  stop_signal varchar(32) not null,
  restart_policy varchar(255) not null check (restart_policy in ('NEVER','ON_FAILURE','ALWAYS')),
  max_restarts integer not null,
  created_at timestamp(6) with time zone not null,
  updated_at timestamp(6) with time zone not null,
  repository_id varchar(255) not null,
  primary key (id)
);
alter table repository_daemon
  add constraint FK_repository_daemon_repository
  foreign key (repository_id) references Repository (id);

create table repository_daemon_env (
  repository_daemon_id varchar(255) not null,
  env_value varchar(2000),
  env_key varchar(255) not null,
  primary key (repository_daemon_id, env_key)
);
alter table repository_daemon_env
  add constraint FK_repository_daemon_env_daemon
  foreign key (repository_daemon_id) references repository_daemon (id);

create table repository_daemon_observer (
  repository_daemon_id varchar(255) not null,
  observer_index integer not null,
  kind varchar(255) not null check (kind in ('PATTERN','MODEL')),
  pattern varchar(500),
  severity varchar(255) check (severity in ('INFO','WARNING','ERROR')),
  prompt varchar(4000),
  primary key (repository_daemon_id, observer_index)
);
alter table repository_daemon_observer
  add constraint FK_repository_daemon_observer_daemon
  foreign key (repository_daemon_id) references repository_daemon (id);

-- Extend command.kind with DAEMON. V13 created the check inline (unnamed), so recreate the
-- column: H2 drops the anonymous constraint with the column it belongs to.
alter table command add column kind_tmp varchar(255) not null default 'TERMINAL'
  check (kind_tmp in ('TERMINAL','CHAT','DAEMON'));
update command set kind_tmp = kind;
alter table command drop column kind;
alter table command rename column kind_tmp to kind;
