# Action Configuration

An action configuration defines a reusable unit of work that QITS can execute: a plain shell script (execute script), an optional check script, an environment variable map, and an **interactive** flag. Users create, parameterize, and compose actions to build iteration pipelines.

Actions abstract the underlying commands, scripts, or integrations so that teams can standardize how work is performed across environments.

## Scope

Actions exist at two scopes, merged into one effective set per repository:

- **Global** actions are available in every repository. They are the ones managed through the Actions UI.
- **Repository-scoped** actions belong to a single repository. They are primarily authored by coding agents through the actions tool server (see the coding-agent domain), letting an agent tailor a repository's runnable actions.

## Where actions are consumed

- **Feature flows**: a lead developer attaches action configurations to phase steps as either **Prerequisites** or **Quality Gates**. The action-configuration domain is authored by developers and consumed by lead developers during feature flow design.
- **Direct execution in workspaces**: an *interactive* action can be run against a workspace from the repository's branch tree ("Run…"). The run is spawned as a persistent **command** (see the command domain) and opens in a live terminal.

The UI reflects the feature-flow relationship: the **Actions** page is reachable from the Feature Flows list and detail pages as a secondary navigation action, not as a top-level sidebar item.

## User Stories

- [Manage Actions](manage-actions.md)
