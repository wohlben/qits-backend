# Retire Feature Flow

## User Story

As a lead developer, I want to remove an obsolete feature flow so that it no longer appears as an option for new work.

## Builds On

1. `feature-flow/design-feature-flow`

## UX Flow

1. Navigate to the feature flow detail page.
2. Click the **Delete** button in the page actions.
3. Confirm the deletion.
4. The feature flow and all its nested data (phases, steps, action attachments) are removed.

> **Note:** The UI presents this as a single delete action. The backend is responsible for cascading cleanup of child entities (actions → steps → phases → configuration). The domain model lists the cascade order explicitly because the underlying REST surface exposes individual DELETE endpoints for each level, but the frontend does not require the user to walk this hierarchy manually.

## Processes

- `feature-flow-configurations-id` — delete the top-level flow (triggers backend cascade)
- `feature-flow-phases-id` — delete an individual phase (used internally by cascade)
- `feature-flow-phase-steps-id` — delete an individual step (used internally by cascade)
- `feature-flow-phase-actions-id` — delete an individual action attachment (used internally by cascade)
