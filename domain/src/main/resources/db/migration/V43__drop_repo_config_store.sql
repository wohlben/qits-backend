-- Part 5 (config-as-single-source-of-truth): the committed .qits-config.yml, read in-container
-- via WorkspaceConfigReader/ConfigView, becomes the only config source. The host-side repo-scoped
-- DB config store is dropped, not migrated: repository_daemon(+env/healthcheck), bootstrap_command
--(+env), the ActionConfiguration.repository_id scope column, and Repository.config_warning (the
-- reconciler's warning column — the reconciler itself is gone).
--
-- Existing repo-scoped rows are DELETED (pre-release; re-declare in .qits-config.yml). The global
-- (code-based) ActionConfiguration rows are untouched. workspace_bootstrap_run STAYS (string-keyed
-- snapshot, no FK to bootstrap_command).

-- 1. Unbind feature-flow bindings that reference repo-scoped actions (FK from V1).
delete from feature_flow_phase_action
  where action_configuration_id in
    (select id from ActionConfiguration where repository_id is not null);

-- 2. Delete the repo-scoped actions themselves (env rows first, FK from V4).
delete from action_configuration_env
  where action_configuration_id in
    (select id from ActionConfiguration where repository_id is not null);
delete from ActionConfiguration where repository_id is not null;

-- 3. Drop the scope column + its FK (both added by V27).
alter table ActionConfiguration drop constraint FK_action_configuration_repository;
alter table ActionConfiguration drop column repository_id;

-- 4. Drop the RepositoryDaemon definition store (V14 + V31; observers/sources already went in V42).
drop table repository_daemon_healthcheck;
drop table repository_daemon_env;
drop table repository_daemon;

-- 5. Drop the BootstrapCommand definition store (V35). workspace_bootstrap_run survives.
drop table bootstrap_command_env;
drop table bootstrap_command;

-- 6. Drop the reconciler's warning column (V34).
alter table Repository drop column config_warning;
