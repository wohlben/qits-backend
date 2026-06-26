# Manage Actions

## User Story

As a developer, I want to define and manage reusable actions so that my team can enforce consistent prerequisites and quality gates across feature flows without duplicating setup steps.

## UI Flow

1. The user navigates to **Actions** from the Feature Flows list page.
2. The actions list shows all reusable action configurations as cards.
3. Clicking **New Action** opens the create form (name, description, execute script, check script).
4. Clicking an existing action opens its detail page, showing the scripts in read-only form.
5. From the detail page the user can **Edit** or **Delete** the action.
6. Create and update share the same form component.

## Processes

- `action-configurations` — list and create
- `action-configurations-id` — get, update, and delete
