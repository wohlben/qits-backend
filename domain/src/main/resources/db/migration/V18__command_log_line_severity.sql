-- Per-line severity where lines are persisted: DAEMON commands' OUTPUT lines are classified
-- locally (the LOG_LEVEL vocabulary) at persist time, enabling ?severity= filters on the command
-- log endpoint without re-parsing. Null on routine output and on non-daemon commands; existing
-- rows stay null (they were captured before classification existed).

alter table command_log_line add column severity varchar(255)
  check (severity in ('INFO','WARNING','ERROR'));
