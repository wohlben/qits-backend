# Adapt Feature Flow

## User Story

As a lead developer, I want to adjust an existing feature flow so that it keeps pace with evolving team processes and quality requirements.

## Builds On

1. `feature-flow/design-feature-flow`

## UX Flow

Adaptation reuses the same phase editing surface described in the design flow:

1. Navigate to the feature flow detail page.
2. Click **Edit** on any phase card to enter edit mode for that phase.
3. While in edit mode:
   - Rename the phase or update its description.
   - Rename existing steps inline.
   - Remove actions from steps.
   - Attach new actions to steps.
   - Add new steps.
   - Delete existing steps.
4. Click **Save** to persist all phase-level changes, or **Cancel** to discard.
5. From the detail page, click **Edit** (top-level) to rename the feature flow itself.

All changes to steps and actions are immediate mutations (Save Step, Add Action, Remove Action, Delete Step). There is no batch/draft mode; the backend is the source of truth.

## Processes

- `feature-flow-configurations-id` — update the flow name
- `feature-flow-phases-id` — update phase name/description
- `feature-flow-phase-steps-id` — update step name
- `feature-flow-phase-actions-id` — update or delete action attachments
