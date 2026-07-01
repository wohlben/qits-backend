-- Drop ActionVariant. Launching a coding agent (e.g. Claude Code with an MCP server) is no longer
-- modelled as an action variant but as a separate agent code path; actions are plain shell scripts
-- again, so the variant column is gone from both action tables.

alter table ActionConfiguration drop column variant;
alter table repository_action drop column variant;

-- Agent sessions are spawned through the same command registry but aren't backed by an action, so a
-- command row may now have no action id.
alter table command alter column action_id set null;
