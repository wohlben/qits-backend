-- TRANSCRIPT log channel: agent-session transcript lines imported from the harness's persisted
-- JSONL (main session + subagent sidechains), distinct from intercepted stdio so chat's existing
-- OUTPUT persistence stays untouched. The V9 channel check was inline (unnamed), so the column is
-- recreated to replace it (same trick as V15).

alter table command_log_line add column channel_tmp varchar(255) not null default 'OUTPUT'
  check (channel_tmp in ('STDIN','OUTPUT','STDERR','TRANSCRIPT'));
update command_log_line set channel_tmp = channel;
alter table command_log_line drop column channel;
alter table command_log_line rename column channel_tmp to channel;
