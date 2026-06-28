-- Repository-scoped actions: a separate table for actions owned by a single repository (e.g. that
-- repo's test-suite command), kept apart from the global ActionConfiguration library. The runnable
-- set for a repository is the merge of the global actions and the repository's own.

create table repository_action (
  id varchar(255) not null,
  check_script varchar(4000),
  created_at timestamp(6) with time zone not null,
  description varchar(255),
  execute_script varchar(4000) not null,
  interactive boolean not null,
  name varchar(255) not null,
  updated_at timestamp(6) with time zone not null,
  repository_id varchar(255) not null,
  primary key (id)
);

create table repository_action_env (
  repository_action_id varchar(255) not null,
  env_value varchar(2000),
  env_key varchar(255) not null,
  primary key (repository_action_id, env_key)
);

alter table if exists repository_action
  add constraint FK_repository_action_repository
  foreign key (repository_id) references Repository;

alter table if exists repository_action_env
  add constraint FK_repository_action_env_action
  foreign key (repository_action_id) references repository_action;
