# quarkus-angular-integration guide documents the removed service-definition CRUD API

## Introduction

Related plans/documents:

- `docs/guides/quarkus-angular-integration.md` — the affected guide
- `docs/epics/qits-workspace-daemon/features/2026-07-24_config-as-single-source-of-truth.md` — the
  feature that removed the DB-backed definition store the guide still describes
- `docs/epics/qits-workspace-services/` — the (renamed) workspace-services epic the guide's feature
  links point into

## Observed

While renaming the old "Workspace Daemons" concept to "Workspace Services" (this branch), the
concept wording, URLs (`/service/{ws}/{serviceId}/`), and endpoint names
(`/api/service-events`) in `docs/guides/quarkus-angular-integration.md` were updated in place. But
the guide's *structure* is stale beyond wording: Tier 1/2/3 walk through creating and editing
service definitions via a REST CRUD API —

- `POST /api/repositories/<repoId>/daemons` (create definition)
- full-`PUT` definition updates (web view, healthchecks, observers), "apply on next relaunch"

— none of which exists anymore. Since config-as-single-source-of-truth landed, service definitions
live exclusively in the repository's committed `.qits-config.yml` (read in-container by the
workspace-daemon; `V43__drop_repo_config_store.sql` dropped the tables). The guide also still
documents log observers (`observers`), a subsystem removed by `V42__drop_service_log_observation.sql`.

## Suspected cause

The guide was written against the DB-definition era and was not updated in the same commits that
removed the definition store and log observation (the project rule says the change that breaks a
guide updates it in the same commit).

## Suggested fix direction

Rewrite the definition-editing steps around `.qits-config.yml` (`services:` key — see the
`testing-repo-quarkus-angular` fixture's committed config as the reference), drop the log-observer
tier entirely, and re-verify each `curl`/UI step against the current endpoints
(`/api/repositories/{repoId}/workspaces/{workspaceId}/services`, `/api/service-events`).
