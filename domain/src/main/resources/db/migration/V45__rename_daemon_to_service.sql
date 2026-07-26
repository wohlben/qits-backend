-- The old "workspace daemons" concept is now "workspace services" (the pid1 workspace-daemon keeps
-- its name). Rename the durable event table + its columns and the stored command kind to match the
-- renamed Java side (ServiceEvent's @Table/@Column, CommandKind.SERVICE).

alter table daemon_event rename to service_event;
alter table service_event alter column daemon_id rename to service_id;
alter table service_event alter column daemon_name rename to service_name;
alter index if exists idx_daemon_event_worktree rename to idx_service_event_worktree;

-- command.kind: DAEMON -> SERVICE. V14 created the check inline (unnamed), so recreate the column
-- with the new value set (same swap V14 itself used).
alter table command add column kind_tmp varchar(255) not null default 'TERMINAL'
  check (kind_tmp in ('TERMINAL','CHAT','SERVICE'));
update command set kind_tmp = case when kind = 'DAEMON' then 'SERVICE' else kind end;
alter table command drop column kind;
alter table command rename column kind_tmp to kind;
