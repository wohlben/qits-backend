-- Per-session transcript statistics, aggregated by the post-exit transcript sweep so the session
-- history UI never re-parses transcript CLOBs at read time. One row per session (agent_id null:
-- the operator-facing message count) plus one per subagent sidechain (agent_id set, labeled from
-- its meta.json). Rows are delete-and-reinserted per session alongside the TRANSCRIPT channel
-- sweep — the latest import wins, and the table stays recomputable from the transcripts.

create table agent_session_stat (
  id varchar(255) not null,
  command_id varchar(255) not null,
  session_id varchar(36) not null,
  agent_id varchar(255),
  agent_type varchar(255),
  description varchar(1024),
  message_count integer not null,
  first_timestamp timestamp(6) with time zone,
  primary key (id)
);
alter table agent_session_stat
  add constraint FK_agent_session_stat_command
  foreign key (command_id) references command on delete cascade;
create index idx_agent_session_stat_session on agent_session_stat (session_id);
