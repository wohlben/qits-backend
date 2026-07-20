-- The per-workspace prompt-composition draft (docs/epics/qits-workspace-detail/feature-ideas/
-- refresh-resilient-prompt-building.md). One row per workspace: the primary key IS the workspace's
-- id (a shared PK/FK), since the draft is strictly 1:1 with a workspace. `content` is the opaque
-- composition JSON the UI owns; `serialized_prompt` is the launch-ready markdown the server serves
-- to the agent. The workspace row is soft-deleted, so this cascade is defensive — the service
-- deletes the draft explicitly on discard.
create table workspace_prompt_draft (
  workspace_id_fk   bigint not null,
  content           clob   not null,
  serialized_prompt clob,
  updated_at        timestamp(6) not null,
  primary key (workspace_id_fk),
  constraint FK_workspace_prompt_draft_workspace
    foreign key (workspace_id_fk) references workspace (id) on delete cascade
);
