-- Agent session lineage: the ordered list of coding-agent sessions a command drove. One command
-- can traverse several sessions (the interactive TUI lets the user /resume away from the pinned
-- session mid-run), so session identity is a collection table, not a column — same
-- element-collection split as the daemon observer/source tables. The session_id index backs
-- lineage queries (all commands that drove a session = its conversation thread) and the
-- resume/fork ownership check.

create table command_agent_session (
  command_id varchar(255) not null,
  session_index integer not null,
  session_id varchar(36) not null,
  source varchar(255) not null
    check (source in ('PINNED','RESUMED','FORKED','SWITCHED')),
  forked_from_session_id varchar(36),
  transcript_path varchar(1024),
  recorded_at timestamp(6) with time zone not null,
  primary key (command_id, session_index)
);
alter table command_agent_session
  add constraint FK_command_agent_session_command
  foreign key (command_id) references command;
create index idx_command_agent_session_session on command_agent_session (session_id);
