-- Run actions: an ActionConfiguration can now be run as an interactive process in a worktree
-- terminal. checkScript becomes optional (a run-only action like "Bash" has no meaningful check),
-- and actions gain an environment-variable map overlaid on the inherited process environment.

alter table ActionConfiguration alter column check_script set null;

create table action_configuration_env (
  action_configuration_id varchar(255) not null,
  env_key varchar(255) not null,
  env_value varchar(2000),
  primary key (action_configuration_id, env_key)
);

alter table if exists action_configuration_env
  add constraint FK_action_configuration_env_action
  foreign key (action_configuration_id) references ActionConfiguration;
