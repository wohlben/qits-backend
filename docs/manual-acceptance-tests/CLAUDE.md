# docs/manual-acceptance-tests/

Manual end-to-end acceptance plans: scripted walks a human (or an agent driving a real browser)
performs against a **realistically deployed** qits to accept a feature surface as a whole. They
cover what the automated suites deliberately don't — packaged images instead of `quarkus:dev`,
real containers on `qits-net`, real browsers, multi-service flows, wall-clock waits — and they are
the checklist to re-run before calling a deployment-affecting change done.

## Directory structure

```
docs/manual-acceptance-tests/
  CLAUDE.md                     <- this file
  <domain>/                     <- one directory per feature domain (dogfooding, deployment,
                                   workspace, telemetry, ...)
    <plan>/                     <- one directory per acceptance plan, kebab-case
      plan.md                   <- REQUIRED: the plan itself
      *.{md,png,yml,sh,...}     <- OPTIONAL sister documents: deep-dive notes, reference
                                   screenshots, compose overlays, helper scripts — anything the
                                   plan needs beyond prose. plan.md links every sister it uses.
```

`plan.md` is always the entry point; a reader who opens nothing else must be able to run the walk.
Sister documents exist only when detail would bloat the plan (a compose overlay to `docker compose
-f … -f …` in, an annotated screenshot of the expected UI state, a long troubleshooting appendix).

## What a plan.md contains

1. **Introduction** — what experience this accepts, and links to the related feature docs/guides
   (same convention as every other doc in this repo).
2. **Preconditions** — host requirements, images/networks that must exist, expected duration.
3. **Steps** — imperative, copy-paste-complete commands and UI actions, each with an explicit
   *Expect:* line stating the observable result. A step without an expectation is not a test step.
4. **Acceptance checklist** — the boiled-down pass/fail list; the walk passes when every box does.
5. **Cleanup** — how to return the machine to its prior state (and what deliberately persists).
6. **Troubleshooting** (optional) — known failure modes and their causes.

## Conventions

- Like `docs/guides/`, these are **current-state contracts**: no date prefix, updated in place —
  the change that invalidates a step updates the plan in the same commit.
- Plans are **repeatable**: prefer idempotent setup (create-if-absent), state the reset path, and
  never depend on leftovers from a previous run.
- Bugs found while walking a plan are documented immediately in `docs/issues/` (the standard
  document-on-encounter rule); the plan gets a troubleshooting note only if the bug is accepted
  behavior for now.
- Agent-driven runs use `npx -y agent-browser` (see `.claude/skills/verify/` for the driving
  patterns); the steps are written so a human in a normal browser can follow the same walk.
