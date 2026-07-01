-- How a command's process is driven and rendered: a PTY TERMINAL (default) or a stream-json CHAT
-- (Claude Code driven over plain pipes, rendered as a conversation). Existing rows are terminals.
alter table command add column kind varchar(255) not null default 'TERMINAL'
  check (kind in ('TERMINAL','CHAT'));
