# Speak-to-prompt: a worktree "work in progress" page

## Introduction

Deciding what to do in a worktree meant typing. Now every worktree-backed branch on the
repository detail page has a **"Work on it"** button that opens a dedicated WIP route
(`/repositories/:repoId/worktrees/:worktreeId/wip`). There you press **Record** and
describe the work out loud: the browser records a WAV, the backend transcribes it with
**NVIDIA Parakeet** (ONNX, CPU, fully local), the transcript is editable, a small Claude
model (**haiku**) rewrites it into a coherent coding-agent prompt, and the refined prompt
launches the worktree's agent chat.

Related plans:
- Builds on the [coding-agent-harness](2026-07-01_coding-agent-harness.md): the refinement
  is a one-shot `CodingAgent` run, and the builder gained a `.model(String)` flag.
- Ends in the [stream-json chat](2026-07-01_stream-json-chat.md): the launched agent is the
  existing chat command; the prompt seeds it as the first user turn.

## What was built

### Speech-to-text (server-side Parakeet)

**`TranscriptionService`** (`domain/.../speech/control/`): transcribes browser-recorded
WAVs by shelling out (via `ProcessExecutor`) to a small Python runner using
[onnx-asr](https://github.com/istupakov/onnx-asr) with `nemo-parakeet-tdt-0.6b-v2`
(int8-quantized ONNX, CPU-only — top-tier English accuracy, ~half Moonshine's word error
rate). Everything is self-managed under `qits.speech.home` (`~/.qits/speech`):

- The **venv bootstraps itself** (`python3 -m venv` + `pip install onnx-asr[cpu,hub]`) on
  first use; the runner script (`domain/src/main/resources/speech/transcribe.py`) ships as
  a classpath resource and is re-materialized on every bootstrap check.
- The ~700 MB model downloads from the Hugging Face hub into its cache on first use; the
  service **warms this up at startup** in the background (`qits.speech.warmup-on-start`,
  set only in the service app — the cli never transcribes).
- Recordings ≤25 s use plain `recognize()`; longer ones are segmented with silero VAD and
  the segment texts joined (`transcribe.py`).
- Transcription takes a few seconds on CPU; stdout of the runner is exactly the transcript.

**`SpeechController`**: `POST /api/speech/transcriptions` `{audioBase64}` → `{text}`.
Base64-in-JSON keeps the OpenAPI→generated-client chain trivial; clips are small (16 kHz
mono ≈ 2 MB/min) with a 30 MB server-side cap.

**History**: the first iteration ran Moonshine (moonshine-js) in the browser. It worked,
but real-microphone accuracy was not usable, so STT moved server-side to Parakeet. The
in-browser attempt left two lessons that survive in the recorder: create the
`AudioContext` synchronously inside the click gesture (created after slow awaits it starts
'suspended' and records silence), and surface a live mic level so silent input is visible.

### Prompt refinement (haiku via the CLI harness)

**`CodingAgent.model(String)`** (`agent/control/`): renders `--model '<id>'` on every
launch variant (`start()`/`run()`/`chat()`).

**`PromptRefinementService`** (`agent/control/`): rewrites the raw transcript into a
coding-agent prompt via `CodingAgentFactory.ofType(CLAUDE).model(refinementModel).run(metaPrompt)`.
The meta-prompt embeds the worktree's branch and preamble (goal) and instructs the model
to fix STT artifacts, preserve every technical detail, invent nothing, and output only the
prompt text. Runs **directly** through **`ProcessExecutor`** (timeout-capable one-shot
runner, stdout/stderr kept separate — stdout *is* the refined prompt) rather than the
command registry: refinements are ephemeral and shouldn't pollute command history. Runs in
a neutral cwd so the target repo's CLAUDE.md isn't loaded for a pure text-rewrite call.
Model configurable: `qits.refinement.model` (default `haiku`).

**`PromptRefinementController`**:
`POST /api/repositories/{repoId}/worktrees/{worktreeId}/prompt-refinements`
`{transcript}` → `{prompt}`. Synchronous; typically 5–20 s.

**`initialContext` on agent chat launches now works** (`AgentLaunchService.launchChat`):
it was accepted but silently dropped. A stream-json chat only speaks over stdin, so the
seed prompt is written as the first user turn via `CommandRegistry.chatSend` right after
spawn (the pipe buffers until claude reads stdin).

### Frontend

**`WavRecorder`** (`pattern/speech/wav-recorder.ts`): plain Web Audio — 16 kHz mono
capture via ScriptProcessorNode, 16-bit PCM WAV encoding, base64 out. No ML in the
browser, no npm deps. Live mic-level signal, gesture-safe AudioContext, chatty `[speech]`
console logging (speech capture has many silent failure modes), and actionable
`getUserMedia` error messages (denied / no mic / mic busy).

**WIP page** (`pages/repositories/worktree-wip/worktree-wip.page.ts`): shows the worktree
(branch, parent, preamble as markdown) above `pattern/speech/speak-to-prompt.component.ts`
— Record → Stop (uploads + "Transcribing…") → editable transcript → **Refine into
prompt** (or "Use transcript as-is") → editable prompt → **Launch agent with this
prompt** → navigates to `/commands/:id`. The worktrees query shares the key *and shape*
of the branch list's (`['worktrees', repoId]` → `WorktreeDto[]`).

**Navigation**: `branch-row` gained an `openWip` output ("Work on it", worktree rows
only), forwarded through `branch-tree` and handled in `branch-list`.

## Known limitations

- First-ever transcription on a fresh machine pays the venv bootstrap + model download
  unless the startup warmup finished first (watch the service log for "Speech
  transcription warmed up").
- Requires `python3` (≥3.10, with the venv module) on the server host; onnxruntime ships
  wheels up to Python 3.14.
- Recording is per-clip (record → stop → transcribe), not live streaming.
- `claude -p` refinement takes ~5–20 s and needs the `claude` CLI logged in on the server.
- English-focused model (`parakeet-tdt-0.6b-v2`).

## Testing

- `CodingAgentFactoryTest` — `--model` rendering on all launch variants.
- `PromptRefinementServiceTest` — script contents (model flag, transcript, preamble,
  branch fallback), neutral cwd, trim, blank/invalid/unknown inputs, non-zero exit,
  timeout, empty output (fake `ProcessExecutor` via `QuarkusMock`).
- `TranscriptionServiceTest` — venv bootstrap command sequence, runner-script
  materialization, size/empty validation, runner failure/timeout mapping (fake
  `ProcessExecutor`).
- `PromptRefinementControllerTest` / `SpeechControllerTest` — validation-only (never
  need claude or python).
- `speak-to-prompt.component.spec.ts` — upload posts base64 and appends the transcript;
  refine posts the edited transcript; launch posts `{scope, initialContext}` and
  navigates.
- `branch-row.component.spec.ts` — "Work on it" only on worktree-backed rows.
- Verified end-to-end with a fake-mic browser fed synthesized speech: word-perfect
  Parakeet transcript → haiku-refined prompt → agent launch.
