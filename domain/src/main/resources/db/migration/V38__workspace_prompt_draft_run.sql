-- Prompt-draft versioning + run-tracking (docs/epics/qits-coding-agents/feature-ideas/
-- mcp-task-prompt-delivery.md, step 5). `prompt_version` is a monotonic counter bumped on every
-- content-changing upsert, naming the exact draft state a launch handed to the agent. The
-- `last_run_*` columns record which version was delivered to which agent run (the launched Command
-- id owns the session lineage), so re-opening the Agents tab doesn't re-run an already-delivered
-- prompt and the UI can show "handed to the agent".
alter table workspace_prompt_draft add column prompt_version bigint not null default 0;
alter table workspace_prompt_draft add column last_run_at timestamp(6);
alter table workspace_prompt_draft add column last_run_prompt_version bigint;
alter table workspace_prompt_draft add column last_run_command_id varchar(255);
