
    alter table if exists feature_flow_phase_action 
       drop constraint if exists UKlg7ba77mocuiogsu7xgntwdsn;

    alter table if exists feature_flow_phase_action 
       add constraint UKlg7ba77mocuiogsu7xgntwdsn unique (step_id, action_configuration_id);

    alter table if exists worktree 
       drop constraint if exists UKbkq1qh0xfkl7ivu3v5e60rhh4;

    alter table if exists worktree 
       add constraint UKbkq1qh0xfkl7ivu3v5e60rhh4 unique (repository_id, worktree_id);
