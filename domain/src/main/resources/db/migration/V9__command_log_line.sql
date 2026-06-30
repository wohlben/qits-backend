-- The MitM audit log: every captured STDIN/OUTPUT line of a command, with a per-line timestamp and a
-- monotonic per-command sequence for stable ordering. High-volume, so a sequence-generated bigint id
-- (like worktree). Content is a CLOB — the first in this schema — because a single terminal line can
-- exceed varchar limits (e.g. no-newline output or a long progress line).

create sequence command_log_line_SEQ start with 1 increment by 50;

create table command_log_line (
  id bigint not null,
  command_id varchar(255) not null,
  seq bigint not null,
  channel varchar(255) not null
    check ((channel in ('STDIN','OUTPUT','STDERR'))),
  content clob not null,
  at timestamp(6) with time zone not null,
  primary key (id)
);

alter table if exists command_log_line
  add constraint FK_command_log_line_command
  foreign key (command_id) references command;
