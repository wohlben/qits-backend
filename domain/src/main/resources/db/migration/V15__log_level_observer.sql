-- Log observers: the LLM-backed MODEL kind becomes LOG_LEVEL — local, deterministic
-- classification off the log lines' own severity tokens. No outbound API calls from log
-- observation, so the per-observer classifier prompt override goes away with it. The V14 kind
-- check was inline (unnamed), so the column is recreated to replace it.

alter table daemon_configuration_observer add column kind_tmp varchar(255) not null default 'PATTERN'
  check (kind_tmp in ('PATTERN','LOG_LEVEL'));
update daemon_configuration_observer
  set kind_tmp = case when kind = 'MODEL' then 'LOG_LEVEL' else kind end;
alter table daemon_configuration_observer drop column kind;
alter table daemon_configuration_observer rename column kind_tmp to kind;
alter table daemon_configuration_observer drop column prompt;

alter table repository_daemon_observer add column kind_tmp varchar(255) not null default 'PATTERN'
  check (kind_tmp in ('PATTERN','LOG_LEVEL'));
update repository_daemon_observer
  set kind_tmp = case when kind = 'MODEL' then 'LOG_LEVEL' else kind end;
alter table repository_daemon_observer drop column kind;
alter table repository_daemon_observer rename column kind_tmp to kind;
alter table repository_daemon_observer drop column prompt;
