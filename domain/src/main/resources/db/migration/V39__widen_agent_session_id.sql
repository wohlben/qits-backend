-- Widen agent session id columns so harness-native ids like Kimi Code's `session_<uuid>` fit.
-- Claude ids remain canonical UUIDs (36 chars); Kimi ids are `session_<uuid>` (44 chars).

alter table command_agent_session alter column session_id varchar(64) not null;
alter table command_agent_session alter column forked_from_session_id varchar(64);
alter table agent_session_stat alter column session_id varchar(64) not null;

-- Kimi Code cannot pin a session id at launch, so the first hook report establishes the session
-- with the new REPORTED source. The V28 check was inline (unnamed), so the column is recreated to
-- replace it (same trick as V15/V29).

alter table command_agent_session add column source_tmp varchar(255) not null default 'PINNED'
  check (source_tmp in ('PINNED','RESUMED','FORKED','SWITCHED','REPORTED'));
update command_agent_session set source_tmp = source;
alter table command_agent_session drop column source;
alter table command_agent_session rename column source_tmp to source;
