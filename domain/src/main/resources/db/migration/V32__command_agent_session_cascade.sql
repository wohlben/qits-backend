-- V28 declared the command_agent_session FK without `on delete cascade`, so deleting a repository
-- (whose command rows are removed by the V10 DB-level cascade, not the entity manager — the
-- @ElementCollection cascade never fires on that path) violated the FK as soon as a command had a
-- persisted agent session. Same repair V10 applied to command/command_log_line and V30 already got
-- right for agent_session_stat.

alter table command_agent_session drop constraint if exists FK_command_agent_session_command;
alter table command_agent_session
  add constraint FK_command_agent_session_command
  foreign key (command_id) references command on delete cascade;
