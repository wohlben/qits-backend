-- Daemon definitions gain an optional HTTP port: when set, the daemon serves HTTP on this
-- port inside its worktree container and becomes web-viewable through the qits reverse proxy
-- at /daemon/{worktreeId}/{daemonId}/ (see docs/features/2026-07-05_daemon-webview-picker.md).
alter table repository_daemon
    add column http_port integer;
