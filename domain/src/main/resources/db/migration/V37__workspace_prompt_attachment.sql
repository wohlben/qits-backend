-- Per-workspace prompt attachments (docs/epics/qits-workspace-detail/feature-ideas/
-- refresh-resilient-prompt-building.md). Image bytes attached to a workspace's prompt draft live here
-- as their own rows (n:1 with the workspace), NOT base64 inside the draft's opaque `content` blob:
-- keeps the blob small and lets the server enforce a per-image cap + PNG/JPEG magic-byte sniff at
-- upload. The FK is `on delete cascade`, but the workspace row is only soft-deleted, so the service
-- deletes these rows explicitly on discard/abandon (same as workspace_prompt_draft).
create table workspace_prompt_attachment (
  id              varchar(255) not null,
  workspace_id_fk bigint       not null,
  mime_type       varchar(255) not null,
  label           varchar(255) not null,
  source          varchar(255) not null,
  bytes           blob         not null,
  created_at      timestamp(6) not null,
  primary key (id),
  constraint FK_workspace_prompt_attachment_workspace
    foreign key (workspace_id_fk) references workspace (id) on delete cascade
);
create index IX_workspace_prompt_attachment_workspace
  on workspace_prompt_attachment (workspace_id_fk);
