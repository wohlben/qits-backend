-- The generic DB-backed settings store (qits-settings epic): one string value per dotted key, the
-- runtime-editable alternative to build-time config properties. `key` is SQL-reserved, so the PK
-- column is `setting_key`.
-- `value` is a reserved word in H2, so the value column is `setting_value` (matching `setting_key`).
create table setting (
  setting_key varchar(255) not null,
  setting_value clob,
  primary key (setting_key)
);

-- The first setting: the instance-wide default coding-agent harness, superseding the build-time
-- `qits.agent.type` property. A fresh install defaults to claude. Stored as the canonical AgentType
-- name (CLAUDE) so value consumers that compare it directly (the Settings select) match without
-- case handling; SettingsService canonicalizes later writes the same way.
insert into setting (setting_key, setting_value) values ('agent.default-type', 'CLAUDE');

-- The harness chosen for a command, recorded at launch so transcript import and the auth probe
-- resolve per-command (a claude command and a kimi command can coexist in one workspace). Nullable:
-- null => legacy CLAUDE.
alter table command add column agent_type varchar(255);
