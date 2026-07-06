-- The bare http_port becomes the WebView config block: the port the proxy frames plus the route
-- the frame opens at (entry path) and an optional extra served-base sub-path.
-- See docs/features/2026-07-06_daemon-webview-configuration.md.
ALTER TABLE repository_daemon ALTER COLUMN http_port RENAME TO web_view_port;
ALTER TABLE repository_daemon ADD COLUMN web_view_entry_path VARCHAR(500);
ALTER TABLE repository_daemon ADD COLUMN web_view_base_path VARCHAR(500);
