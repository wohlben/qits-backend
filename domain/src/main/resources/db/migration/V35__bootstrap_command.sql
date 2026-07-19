-- Bootstrap commands: a repository's ordered one-shot chain run after fresh container
-- provisioning (before daemon auto-start), plus the per-workspace last-run record backing the
-- workspace bootstrap surface. Mirrors the repository_daemon split: definition table + env
-- element collection.

create table bootstrap_command (
  id varchar(255) not null,
  name varchar(255) not null,
  description varchar(255),
  execute_script varchar(4000) not null,
  check_script varchar(4000),
  order_index integer not null,
  created_at timestamp(6) with time zone not null,
  updated_at timestamp(6) with time zone not null,
  repository_id varchar(255) not null,
  primary key (id)
);
alter table bootstrap_command
  add constraint FK_bootstrap_command_repository
  foreign key (repository_id) references Repository (id);

create table bootstrap_command_env (
  bootstrap_command_id varchar(255) not null,
  env_value varchar(2000),
  env_key varchar(255) not null,
  primary key (bootstrap_command_id, env_key)
);
alter table bootstrap_command_env
  add constraint FK_bootstrap_command_env_command
  foreign key (bootstrap_command_id) references bootstrap_command (id);

-- One row per (workspace row, bootstrap command), overwritten on every run. bootstrap_command_id
-- is a snapshot, not a FK (the command.action_id precedent) — deleting/reconciling a command
-- never breaks recorded state. The workspace FK carries `on delete cascade` (like every other
-- workspace-child FK, V10) because Repository.workspaces is a DB-level cascade with no JPA
-- relationship on the Workspace side to these rows — without it, deleting a repository/project
-- (which cascade-deletes its workspace rows) fails the moment a bootstrap run was recorded.
create table workspace_bootstrap_run (
  id varchar(255) not null,
  workspace_id_fk bigint not null,
  bootstrap_command_id varchar(255) not null,
  command_name varchar(255) not null,
  outcome varchar(255) not null check (outcome in ('SKIPPED','SUCCEEDED','FAILED')),
  command_id varchar(255),
  exit_code integer,
  ran_at timestamp(6) with time zone not null,
  primary key (id),
  constraint UQ_workspace_bootstrap_run unique (workspace_id_fk, bootstrap_command_id)
);
alter table workspace_bootstrap_run
  add constraint FK_workspace_bootstrap_run_workspace
  foreign key (workspace_id_fk) references workspace (id) on delete cascade;
