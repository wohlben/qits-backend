-- FILE log sources: additional tailed files a daemon's observers watch besides the process
-- output. PROCESS_OUTPUT is implicit and not stored, so the collections carry only file paths.
-- Same element-collection split as the observer tables.

create table daemon_configuration_source (
  daemon_configuration_id varchar(255) not null,
  source_index integer not null,
  path varchar(1024) not null,
  label varchar(255),
  primary key (daemon_configuration_id, source_index)
);
alter table daemon_configuration_source
  add constraint FK_daemon_configuration_source_daemon
  foreign key (daemon_configuration_id) references daemon_configuration (id);

create table repository_daemon_source (
  repository_daemon_id varchar(255) not null,
  source_index integer not null,
  path varchar(1024) not null,
  label varchar(255),
  primary key (repository_daemon_id, source_index)
);
alter table repository_daemon_source
  add constraint FK_repository_daemon_source_daemon
  foreign key (repository_daemon_id) references repository_daemon (id);
