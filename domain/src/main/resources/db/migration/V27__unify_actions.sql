-- Unify the two action tables: ActionConfiguration absorbs repository_action via a nullable
-- repository_id (null = global, set = repository-scoped). Scope becomes a column instead of a
-- table identity, so feature_flow_phase_action (whose FK already targets ActionConfiguration)
-- can bind actions of either scope — the reason repo-specific actions were previously forced
-- to be global.

alter table ActionConfiguration add column repository_id varchar(255);

alter table if exists ActionConfiguration
  add constraint FK_action_configuration_repository
  foreign key (repository_id) references Repository;

-- Move the repository-scoped actions in (UUID ids, disjoint by construction).
insert into ActionConfiguration
    (id, name, description, execute_script, check_script, interactive,
     created_at, updated_at, repository_id)
  select id, name, description, execute_script, check_script, interactive,
     created_at, updated_at, repository_id
  from repository_action;

insert into action_configuration_env (action_configuration_id, env_key, env_value)
  select repository_action_id, env_key, env_value from repository_action_env;

drop table repository_action_env;
drop table repository_action;
