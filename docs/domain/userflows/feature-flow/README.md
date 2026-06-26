# Feature Flow

A feature flow defines the lifecycle pipeline that a unit of work (such as a feature or bug fix) moves through from inception to completion.

It is composed of ordered phases, each containing steps. Actions from the action-configuration domain are attached to these steps to enforce prerequisites, quality gates, or automated checks.

## UX Principle: The Phase Is the Surface

Although the backend models feature flows as a hierarchy (configuration → phase → step → action), the user does not perceive these as independent entities. For the user, **the phase is the entire configuration surface**: name, description, ordered steps, and the actions attached to those steps.

The UI therefore presents a **single edit mode per phase**. When a user clicks "Edit" on a phase, the entire surface becomes editable inline — step names become inputs, actions show remove buttons, and new steps/actions can be added. There are no separate "Edit" toggles for individual steps or actions. This keeps the mental model simple and avoids forcing the user to think in terms of foreign-key relationships.

## User Stories

- [Design Feature Flow](design-feature-flow.md)
- [Adapt Feature Flow](adapt-feature-flow.md)
- [Retire Feature Flow](retire-feature-flow.md)
