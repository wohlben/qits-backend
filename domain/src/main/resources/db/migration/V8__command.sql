-- Registry-backed commands: every process launched into a worktree (interactive terminal or
-- non-interactive one-off) is recorded here, so the Commands UX can show what is currently active
-- and where it came from, and a terminated run survives a restart. The only foreign key is to the
-- worktree; the branch and the commit hash checked out at launch are snapshot strings (branches and
-- commits are not entities), and the resolved action is snapshotted by id/name/script.

create table command (
  id varchar(255) not null,
  worktree_id_fk bigint not null,
  branch varchar(255) not null,
  commit_hash varchar(255) not null,
  action_id varchar(255) not null,
  action_name varchar(255) not null,
  execute_script varchar(4000) not null,
  status varchar(255) not null
    check ((status in ('RUNNING','EXITED','TERMINATED','INTERRUPTED'))),
  exit_code integer,
  interactive boolean not null,
  launched_at timestamp(6) with time zone not null,
  finished_at timestamp(6) with time zone,
  primary key (id)
);

alter table if exists command
  add constraint FK_command_worktree
  foreign key (worktree_id_fk) references worktree;
