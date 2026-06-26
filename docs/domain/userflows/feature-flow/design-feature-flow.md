# Design Feature Flow

## User Story

As a lead developer, I want to design a feature flow so that every new feature follows a standardized lifecycle with clear phases, steps, and quality gates.

## UX Design Notes

The feature flow is the top-level entity, but the real work happens inside the **phase editing surface** on the detail page. For the user, a phase is not just a name and description — it *is* the entire configuration surface including its ordered steps and the actions attached to those steps. The backend models this as a hierarchy (phase → step → action), but that is a pure implementation detail that must not leak into the UX.

### Creating a feature flow

1. From the Feature Flows list, click **New Feature Flow**.
2. Enter a name. The flow is automatically scoped to the current project.
3. Save. The flow is created and the user is redirected to the detail page.

### Designing phases

1. On the feature flow detail page, click **Add Phase**.
2. A new phase card appears immediately in edit mode (inline name input, description textarea, Save/Cancel).
3. After saving, the phase is created and the card collapses to read mode.
4. Click **Edit** on any phase to re-enter the editing surface.

### Designing steps and actions (inside phase edit mode)

While a phase is in edit mode, the entire surface is editable:

- **Steps** are listed inline below the phase fields. Each step shows its name as an editable input immediately (no separate "Edit" toggle per step).
- Existing actions on a step are shown as badges with a **Remove** button.
- Click **+ Add Action** on a step to attach a reusable action configuration (selected from a dropdown) as either a **Prerequisite** or **Quality Gate**.
- Click **+ Add Step** in the phase card actions to append a new step.
- Click **Save Step** to persist a step name change, or **Delete Step** to remove it.
- Click **Save** on the phase card to persist phase-level changes (name, description).

There is only **one edit mode per phase**. Child entities (steps, actions) do not have their own edit toggles; they inherit editability from the parent phase.

## Processes

- `projects-projectId-feature-flow-configurations` — create a flow scoped to a project
- `feature-flow-phases` — create phases (order index derived automatically from list position)
- `feature-flow-phase-steps` — create steps within a phase (sort order derived automatically)
- `feature-flow-phase-actions` — attach action configurations to steps
