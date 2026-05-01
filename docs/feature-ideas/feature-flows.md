# Feature Flows

## Introduction

**Related / Dependent Plans:**
- [`docs/features/2026-05-01_actions.md`](../features/2026-05-01_actions.md) — The Action domain will be merged *into* Feature Flow, becoming a dedicated part of a feature-flow rather than a standalone domain.
- Future: Feature development instances spawned from a feature-flow configuration.

## Overview

The **Feature Flow** domain models the lifecycle of feature development inside the system. A *feature flow* is configured generally, and the existing **Action** domain module will be merged into it — actions become a dedicated part of a feature-flow rather than standalone configurations.

The main entity is **`FeatureFlowConfiguration`**. It provides the *blueprint* for initiated feature developments. The entity itself exists primarily for **referential integrity**; it needs only a **name** and an **auto-generated ID** to start.

## Current Scope

This first iteration establishes the `FeatureFlowConfiguration` entity with minimal attributes:

| Attribute | Type | Constraints |
|-----------|------|-------------|
| `id`      | `String` (UUID) | Auto-generated primary key |
| `name`    | `String` | Non-nullable |

## Future Extensions

- Action configurations merged into feature-flows (replacing the standalone `action` domain).
- Feature development instances spawned from a configuration.
- Relationships to projects and repositories.
- Ordering / sequencing of actions within a flow.
