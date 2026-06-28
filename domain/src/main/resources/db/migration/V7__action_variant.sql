-- Action variants: a typed, backend-rendered parameterization of an action. SHELL (default) runs
-- executeScript verbatim; CLAUDE_ACTIONS_MCP launches Claude Code with the actions MCP server
-- attached and scoped to the repository it runs in. Existing rows backfill to SHELL via the default.

alter table ActionConfiguration add column variant varchar(255) default 'SHELL' not null;
alter table repository_action add column variant varchar(255) default 'SHELL' not null;
