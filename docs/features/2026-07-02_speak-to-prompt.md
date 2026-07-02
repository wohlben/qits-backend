# Speak-to-prompt: a worktree "work in progress" page

## Introduction

Deciding what to do in a worktree meant typing. Now every worktree-backed branch on the
repository detail page has a **"Work on it"** button that opens a dedicated WIP route
(`/repositories/:repoId/worktrees/:worktreeId/wip`). There you press **Record** and
describe the work out loud: speech is transcribed **locally in the browser** by
[Moonshine](https://github.com/moonshine-ai/moonshine-js) (ONNX Runtime Web — audio never
leaves the machine), the transcript is editable, a small Claude model (**haiku**) rewrites
it into a coherent coding-agent prompt, and the refined prompt launches the worktree's
agent chat.

Related plans:
- Builds on the [coding-agent-harness](2026-07-01_coding-agent-harness.md): the refinement
  is a one-shot `CodingAgent` run, and the builder gained a `.model(String)` flag.
- Ends in the [stream-json chat](2026-07-01_stream-json-chat.md): the launched agent is the
  existing chat command; the prompt seeds it as the first user turn.

## What was built

### Backend

**`CodingAgent.model(String)`** (`agent/control/CodingAgent.java`,
`ClaudeCodeAgent.appendFlags`): renders `--model '<id>'` on every launch variant
(`start()`/`run()`/`chat()`).

**`PromptRefinementService`** (`agent/control/`): turns a raw speech transcript into a
coding-agent prompt via `CodingAgentFactory.ofType(CLAUDE).model(refinementModel).run(metaPrompt)`.
The meta-prompt embeds the worktree's branch and preamble (goal) and instructs the model to
fix STT artifacts, preserve every technical detail, invent nothing, and output only the
prompt text. Runs **directly** through the new **`ProcessExecutor`** (timeout-capable
one-shot runner, stdout/stderr kept separate — stdout *is* the refined prompt) rather than
the command registry: refinements are ephemeral and shouldn't pollute command history. Runs
in a neutral cwd so the target repo's CLAUDE.md isn't loaded for a pure text-rewrite call.
Model is configurable: `qits.refinement.model` (default `haiku`).

**`PromptRefinementController`**:
`POST /api/repositories/{repoId}/worktrees/{worktreeId}/prompt-refinements`
`{transcript}` → `{prompt}`. Synchronous; typically a few seconds.

**`initialContext` on agent chat launches now works** (`AgentLaunchService.launchChat`):
it was accepted but silently dropped. A stream-json chat only speaks over stdin, so the
seed prompt is written as the first user turn via `CommandRegistry.chatSend` right after
spawn (the pipe buffers until claude reads stdin).

### Frontend

**Speech-to-text runs in-browser** via `@usefulsensors/moonshine-js@0.1.21` with the
English **base** model (~60 MB, downloaded and browser-cached on first use). Notes:
- The successor package `@moonshine-ai/moonshine-js` is uninstallable (every version
  publishes a broken `file:../vad-moonshine` dependency), and the old package's `@latest`
  CDN no longer ships the English base model — model assets are **pinned** to
  `@usefulsensors/moonshine-js@0.1.16/dist/` and VAD assets to `@ricky0123/vad-web@0.0.22`
  (immutable jsDelivr URLs) in `pattern/speech/speech-transcriber.ts`.
- `SpeechTranscriber` wraps the library's base `Transcriber` (not its
  `MicrophoneTranscriber`, which re-acquires and never releases mic streams) and owns
  `getUserMedia` itself so the browser's recording indicator turns off on stop. Dynamic
  `import()` keeps the ML runtime out of the initial bundle.
- VAD mode: text arrives per utterance at natural pauses (`onTranscriptionCommitted`);
  a final utterance can land shortly after Stop and still appends. The package ships no
  types — `pattern/speech/moonshine-js.d.ts` declares the used surface.

**WIP page** (`pages/repositories/worktree-wip/worktree-wip.page.ts`): shows the worktree
(branch, parent, preamble as markdown) above `pattern/speech/speak-to-prompt.component.ts`
— Record toggle with listening indicator → editable transcript → **Refine into prompt**
(or "Use transcript as-is") → editable prompt → **Launch agent with this prompt** →
navigates to `/commands/:id`. The worktrees query shares the key *and shape* of the branch
list's (`['worktrees', repoId]` → `WorktreeDto[]`).

**Navigation**: `branch-row` gained an `openWip` output ("Work on it", worktree rows
only), forwarded through `branch-tree` and handled in `branch-list`.

## Known limitations

- Stopping mid-word can lose the final utterance (VAD only commits at a pause) — pause
  briefly before pressing Stop.
- Moonshine models are English-only (the Spanish variant has a different license).
- Model/VAD assets load from jsDelivr at runtime; offline dev breaks speech (the rest of
  the page works). Self-hosting the ONNX files is the escape hatch if that ever matters.
- `claude -p` refinement takes ~5–20 s and needs the `claude` CLI logged in on the server;
  failures surface as a 500 with a stderr tail.

## Testing

- `CodingAgentFactoryTest` — `--model` rendering on all launch variants.
- `PromptRefinementServiceTest` — script contents (model flag, transcript, preamble,
  branch fallback), neutral cwd, trim, blank/invalid/unknown inputs, non-zero exit,
  timeout, empty output (fake `ProcessExecutor` via `QuarkusMock`).
- `PromptRefinementControllerTest` — validation-only (never needs the claude binary).
- `speak-to-prompt.component.spec.ts` — refine posts the edited transcript; launch posts
  `{scope, initialContext}` and navigates; recorder utterances append.
- `branch-row.component.spec.ts` — "Work on it" only on worktree-backed rows.
