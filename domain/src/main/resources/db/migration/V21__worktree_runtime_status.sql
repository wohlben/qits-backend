-- Disposable workspace containers: the container is a recreatable cache of the durable branch, so a
-- worktree needs a runtime status (RUNNING/STOPPED/PROVISIONING/FAILED) separate from its lifecycle
-- `status`. Losing a container no longer abandons the worktree; it just becomes STOPPED and is
-- re-provisioned on demand. `runtime_error` carries the reason of a failed re-provision so the UI
-- can explain why. Default STOPPED: existing rows have no live container recorded until reconciled.
ALTER TABLE worktree ADD COLUMN runtime_status VARCHAR(32) DEFAULT 'STOPPED' NOT NULL;
ALTER TABLE worktree ADD COLUMN runtime_error VARCHAR(2000);
