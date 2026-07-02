# Manage Actions

## User Story

As a developer, I want to define and manage reusable actions so that my team can enforce consistent prerequisites and quality gates across feature flows, and run standardized interactive tasks in worktrees, without duplicating setup steps.

## UI Flow

1. The user navigates to **Actions** from the Feature Flows list page.
2. The actions list shows all reusable action configurations as cards.
3. Clicking **New Action** opens the create form (name, description, execute script, check script, environment variables, interactive flag).
4. Clicking an existing action opens its detail page, showing the scripts, the environment map, and an **Interactive** badge in read-only form.
5. From the detail page the user can **Edit** or **Delete** the action.
6. Create and update share the same form component.

An action's execute script runs verbatim as a shell script — there are no special action "variants". Launching coding agents is a separate concern handled by the coding-agent domain, not by specially-typed actions.

## Processes

- `action-configurations` — list and create
- `action-configurations-id` — get, update, and delete
