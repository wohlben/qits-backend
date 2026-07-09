-- Daemons auto-start with their workspace container. Default true: a repository's daemons are what
-- its workspaces run, so opting out is the marked case (mirrors the entity default). Backfill
-- existing rows to true.
alter table repository_daemon add column auto_start boolean not null default true;
