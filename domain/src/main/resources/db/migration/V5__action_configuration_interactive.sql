-- Distinguish interactive actions (run in a worktree terminal, e.g. a shell or Claude Code) from
-- one-off, non-interactive commands (e.g. `mvn test`). Only interactive actions are offered by the
-- Run… terminal picker.

alter table ActionConfiguration add column interactive boolean default false not null;

-- Backfill the seeded defaults that may already exist from an earlier boot.
update ActionConfiguration set interactive = true where name in ('Bash', 'Claude Code');
