# Fetch-model prompt delivery can silently start a task-less agent

## Introduction

Surfaced by the high-effort code review of the step-6 image-attachment work (findings 9 & 10,
verdict PLAUSIBLE). These concern the **step-5 delivery model**, not step 6 itself:

- [mcp-task-prompt-delivery](../epics/qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
  — the shipped push→fetch switch this issue is about.
- [refresh-resilient-prompt-building](../epics/qits-workspace-detail/feature-ideas/refresh-resilient-prompt-building.md)
  — the persisted draft the agent fetches.

A partial mitigation shipped alongside this doc (a diagnostic warning; see below); the deeper
robustness question is left open here rather than redesigning shipped delivery under a review.

## Observed / suspected

Launches now hand the composed prompt to the agent by having it **fetch** the draft via the
`taskPrompt` MCP tool, instead of pushing the text. Two failure modes leave the agent with no task,
silently:

1. **Interactive/chat — draft raced away.** `AgentControllerService` launches send
   `deliverTaskPrompt: true` with no `initialContext`. Server-side `shouldDeliverBootstrap`
   (`AgentLaunchService`) only pushes the bootstrap turn when
   `promptDraftService.hasDeliverablePrompt()` is true. If it is false — e.g. an SSE-driven delete
   from another device emptied the draft row between `flushNow()` and the launch, or a flushed PUT
   persisted a blank `serializedPrompt` — `seed` falls back to the null `initialContext`: a chat
   sends no first turn, an interactive TUI opens with no argv prompt. The operator sees a live
   session with no task.
2. **Autonomous — MCP/git-host unreachable at launch.** `renderAutonomous` now runs
   `claude -p …TASK_PROMPT_BOOTSTRAP` (the one-sentence "fetch the task prompt and implement it")
   rather than embedding the composed prompt in argv (old `.run(prompt)`). If `qits-net`/the
   in-process git-host/MCP endpoint is momentarily unreachable, `taskPrompt` returns nothing and the
   unattended conflict-resolution agent produces no merge, with no error surfaced to the operator.

Both are inherent to a *fetch* delivery model (any out-of-band fetch can fail where an in-argv push
could not); both are rare (a race window / a transient infra failure), which is why they are
PLAUSIBLE, not confirmed.

## Mitigation shipped

`AgentLaunchService.shouldDeliverBootstrap` now logs a WARN when `deliverTaskPrompt` was requested
but `hasDeliverablePrompt()` is false — so mode 1's silent no-seed launch is diagnosable in the qits
logs instead of a mystery. No behavior change.

## Suggested fix direction (deferred)

- Mode 1: when delivery was requested but nothing is deliverable, either **abort the launch** with a
  clear error (the compose UI already handles a failed pre-launch flush the same way) or push a seed
  telling the agent the task could not be loaded, rather than opening a task-less session.
- Mode 2: give the autonomous run a **guaranteed-delivery fallback** — e.g. embed the composed
  prompt in argv when it carries no image attachments (conflict resolution never does), keeping the
  MCP fetch only for the image-bearing launch shapes that actually need it. Alternatively, have the
  bootstrap turn instruct the agent to fail loudly (non-zero, reported) if `taskPrompt` returns
  nothing, so a lost task surfaces as a failed command rather than a silent no-op.

Trigger to pick up: a real report of an agent session starting with no task, or the autonomous
conflict-resolution flow leaving a workspace untouched with no error.
