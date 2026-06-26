# Action Configuration

An action configuration defines a reusable unit of work that QITS can execute. Users create, parameterize, and compose actions to build iteration pipelines.

Actions abstract the underlying commands, scripts, or integrations so that teams can standardize how work is performed across environments.

## Relationship to Feature Flows

Actions are created and managed independently, but they are consumed inside feature flows. A lead developer attaches action configurations to phase steps as either **Prerequisites** or **Quality Gates**. This means the action-configuration domain is authored by developers and consumed by lead developers during feature flow design.

The UI reflects this relationship: the **Actions** page is reachable from the Feature Flows list and detail pages as a secondary navigation action, not as a top-level sidebar item.

## User Stories

- [Manage Actions](manage-actions.md)
