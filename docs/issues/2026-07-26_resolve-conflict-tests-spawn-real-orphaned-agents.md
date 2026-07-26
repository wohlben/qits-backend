# ResolveConflictServiceTest spawns real, orphaned, task-less claude agents on the host

## Introduction

Related plans and issues:

- [2026-07-20_fetch-model-prompt-delivery-robustness](2026-07-20_fetch-model-prompt-delivery-robustness.md)
  — mode 2 ("autonomous — MCP unreachable at launch") is what every one of these spawned agents
  hits, deterministically rather than transiently.
- [mcp-task-prompt-delivery](../epics/qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
  — the push→fetch delivery model the spawned run rides.
- [2026-07-04_workspace-containers](../epics/qits-workspaces/features/2026-07-04_workspace-containers.md)
  — `FakeContainerRuntime`'s real-host-process design, which is what lets the spawn through.

First-hand provenance: this doc was written by one of the orphaned agents itself — spawned
2026-07-26 ~14:34 for workspace `feat-resolve` of test repo `78545626-…` (the
`eachResolutionGetsItsOwnCommand` fixture shape: `feat`/`feat-resolve`/`feat2`/`feat2-resolve`), it
woke up with no `taskPrompt` tool, watched its working directory get deleted mid-turn by the next
test run's data-dir reset, and had nothing left to implement.

## Observed

Every full run of `./mvnw -pl domain test -Dtest=ResolveConflictServiceTest` on a machine whose
host has the real `claude` CLI **launches four real autonomous claude processes** (one per
`resolveConflict(...)` call: `resolveForksAWorkspacePersistsThePromptAsItsDraftAndLaunchesAFetchRun`,
`injectedCommitMessageTextIsFencedAndNeutralized`, and `eachResolutionGetsItsOwnCommand` twice).
Each spawned agent:

- runs the real `/usr/local/bin/claude --input-format stream-json … --dangerously-skip-permissions`
  as a host process, receives the `TASK_PROMPT_BOOTSTRAP` first turn ("fetch the current task
  prompt … with the taskPrompt tool"), and — if the host's shared `/claude-home` carries real
  credentials — burns real token/subscription spend per test run;
- can never fetch its task: the `/mcp/repository` endpoint is served by the `service` module's HTTP
  server, which a `domain` `@QuarkusTest` does not run — so the launch-script MCP URL is
  unreachable and `taskPrompt` never materializes as a tool (the 2026-07-20 doc's mode 2, but
  deterministic here);
- outlives the test: nothing awaits or kills the spawned chat process, and the test data dir
  (`domain/target/qits-test-repos`) is reset between runs, so the agent is left orphaned with a
  deleted working directory — an unattended, permission-skipping agent loose in the developer's
  environment with no task and no workspace.

`AgentLaunchServiceTest`/`AgentLaunchServiceKimiTest` are not affected — they only exercise
`render*` and guard paths, which build scripts without spawning.

## Suspected cause

`FakeContainerRuntime.exec` deliberately stubs `claude auth status` as logged-in
(`domain/src/test/java/eu/wohlben/qits/domain/repository/control/FakeContainerRuntime.java:150`)
so chat launches take the chat path instead of redirecting to the sign-in REPL — but nothing stubs
the agent binary itself. `execArgv` hands back a host argv on purpose (real host processes are what
give the suite end-to-end process-group termination coverage), so when
`ResolveConflictService.resolveConflict` → `AgentLaunchService.launchAutonomous`
(`domain/src/main/java/eu/wohlben/qits/domain/agent/control/AgentLaunchService.java:282`) reaches
`commandService.launchChat` + `commandRegistry.chatSend`, the registry spawns the host's real CLI.
Before the 2026-07-26 chat-pipeline switch the same tests spawned a one-shot `claude -p`, so the
problem predates that change; the chat rendering just makes the spawned process a long-lived
session rather than a quick one-shot.

## Suggested fix direction

Keep `FakeContainerRuntime`'s real-process design, but make sure the *agent binary* the registry
spawns in tests is a stub, not the real CLI:

- prepend a test-scoped bin dir to `PATH` in the env `FakeContainerRuntime` composes, containing
  `claude`/`kimi` scripts that speak just enough stream-json to exit cleanly (this also lets a
  future test assert the bootstrap turn actually arrived on stdin); or
- intercept at the exec/spawn seam when `argv[0]` is a known agent binary and substitute the stub.

Independently, test teardown could sweep the command registry and kill still-running spawned
commands, so no test-launched process ever outlives its fixture.
