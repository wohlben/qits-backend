# Sketch tab + image prompt attachments: draw a rough sketch, hand it to the coding agent

## Introduction

Sometimes the fastest way to describe a change is a picture: "move this panel here", a rough
layout of a new dialog, an arrow from a button to where its result should appear. Today the
prompt surfaces accept text plus two structured attachment kinds (picked DOM elements, code
references) — but no images. This idea adds two things:

1. **A Sketch tab** on the workspace detail route: a minimal canvas (pen, eraser, undo, clear)
   where the user scribbles a rough drawing — nothing fancy, no shape libraries, no
   persistence ambitions.
2. **Image attachments in the prompt context**: the sketch (or any image pasted from the
   clipboard) becomes a removable attachment row on the Chat tab, exactly like picked
   elements and code references, and is delivered to the coding agent with the prompt.

The delivery question was the research core: qits' primary agent launch (chat mode) writes the
prompt to Claude's **stdin as a stream-json user message whose `content` is an API-style
content-block array** — and that same message shape carries native
`{"type":"image","source":{"type":"base64",…}}` blocks. So for the chat path the image can ride
the existing pipe **inline, with no file ever touching the container** — no upload endpoint, no
new container write primitive, no path juggling. Dropping a PNG into the container and
referencing its path in the prompt also works (Claude Code's Read tool renders images, and
path-referencing is the documented headless approach), but it requires building a host→container
file-write mechanism that today does not exist anywhere in qits — deferred to a follow-up for
the launch shapes that can't take inline blocks.

Related/dependent plans:

- **Rides the picked-elements/code-references attachment machinery** —
  [files-tab-selection-as-prompt-context](../features/2026-07-11_files-tab-selection-as-prompt-context.md)
  promoted `CodeReference` into the root-scoped `PromptContextStore` with Chat-tab rows +
  remove/clear lifecycle; images become the third slice of the same store, third row group of
  the same panel ([speak-to-prompt](../features/2026-07-02_speak-to-prompt.md),
  [daemon-webview-picker](../features/2026-07-05_daemon-webview-picker.md)).
- **Extends the stream-json chat transport** —
  [stream-json-chat](../features/2026-07-01_stream-json-chat.md) /
  [container-agent-sessions](../features/2026-07-04_container-agent-sessions.md):
  `ChatSession.sendUser` builds the `content: [{type:"text",…}]` array this feature widens with
  image blocks; the `ChatCommandSocket` user-turn envelope gains an attachments field.
- **One more `<z-tab>`** in the group owned by
  [workspace-detail-tab-consolidation](../features/2026-07-09_workspace-detail-tab-consolidation.md);
  [draggable tabs](../features/2026-07-09_draggable-workspace-detail-tabs.md) merges unknown
  labels gracefully, and
  [tab-url deep links](../features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
  just need a `Sketch → sketch` slug entry.
- **Sibling of the screenshot idea's deferred "agent vision dispatch"** —
  [capture-rendered-view-screenshot](capture-rendered-view-screenshot.md) explicitly deferred
  "letting the coding agent actually *see* the PNG … inline into the prompt as an image
  block". This feature builds exactly that dispatch leg; once it exists, the capture
  screenshot (and the webview-picker rasterization path) can reuse it.
- **Refresh survival is the sibling idea**
  [refresh-resilient-prompt-building](refresh-resilient-prompt-building.md) — it persists the
  whole prompt-composition state (draft text, picks, references, images, the sketch canvas)
  per workspace; this feature ships without it and stays ephemeral like today's picks.
- **The deferred file-drop follow-up is the write sibling of**
  [container-file-access](../features/2026-07-04_container-file-access.md), whose
  `WorkspaceFileAccess`/`ContainerRuntime` seams are deliberately read-only today (no
  `docker cp`, no stdin-to-file anywhere).

## Research: getting an image to Claude Code

Three mechanisms exist; qits' launch shapes map onto them unevenly.

| Mechanism | Coverage | Verdict |
|---|---|---|
| **Inline stream-json image block** on stdin (`--input-format stream-json`, message `content` array with `{"type":"image","source":{"type":"base64","media_type":"image/png","data":…}}`) | Chat mode only — but chat is both the launch prompt and every live WebSocket turn | **Primary.** Rides the pipe `ChatSession.sendUser` already writes; no filesystem, no new endpoint. Documented on the Agent SDK streaming-input side ("Image Uploads — attach images directly to messages"); the CLI accepts the same envelope, though its docs are thin — a hand spike against a real container is the first implementation step. |
| **File in the container + path in the prompt** ("Analyze this image: /path/to/img.png"; the Read tool renders PNG/JPEG to the model, auto-resizing) | All shapes: chat, interactive TUI, autonomous `claude -p` | The documented universal route, but qits has **no host→container file write today** — building one (a `ContainerRuntime.writeFile` via `docker exec -i … sh -c 'cat > path'` with bytes on stdin) is real new surface, plus path policy (a `/workspace` path dirties git status unless ignored; an outside path may hit read-permission prompts in non-skip-permissions modes). **Deferred follow-up.** |
| Interactive-terminal drag-drop / Ctrl+V paste into the Claude TUI | Interactive sessions, manual only | Already works for whoever attaches to the terminal; nothing for qits to build. |

Size is a non-issue: a sketch PNG is tens of kB (API limit 10 MB/image, and Claude Code
recompresses anyway); base64 in a stream-json line and in the persisted transcript is fine at
that scale, guarded by a server-side cap.

## Research: sketch library

Requirement: freehand pen, eraser, clear, undo, PNG export, no React, small. Findings:

- **atrament** (~2–6 kB gz, MIT, active 2025) — the best fit: vanilla JS over a `<canvas>` you
  own, smooth adaptive strokes, built-in **erase mode**; PNG export is just
  `canvas.toDataURL('image/png')`. No undo by design (deliberately out of scope for the lib) —
  a dataURL snapshot stack on stroke-end is ~20 lines on our side. Toolbar is ours (Tailwind
  buttons), which is what we want anyway for a qits-styled minimal UI.
- **Hand-rolled canvas** — legitimate fallback; pointer events + `lineTo` + 
  `globalCompositeOperation='destination-out'` for the eraser is ~100 lines. atrament mostly
  buys nicer-feeling strokes for near-zero cost.
- Rejected: **excalidraw**/**tldraw** (React-only peer deps — would mean shipping React inside
  the Angular app; tldraw additionally has a watermark/business license), **js-draw** (full
  editor with its own toolbar UI, 4.3 MB unpacked — oversized for "nothing fancy"),
  **fabric/konva** (general canvas engines; we'd still build all the tools),
  **signature_pad** (freehand only, no eraser), **literallycanvas**/**drawingboard.js** (dead
  since 2018).

**Pick: atrament + own toolbar**, with the explicit option to drop to a hand-rolled canvas if
the dependency disappoints — the component API below doesn't change either way.

## Design

### Sketch tab (frontend)

- New `<z-tab label="Sketch">` in `workspace-detail.page.ts` + a `['Sketch', 'sketch']` entry
  in `TAB_SLUG_BY_LABEL`. No routing change — the matcher already accepts any non-`wip` tab
  segment. Panels stay mounted while hidden, so a half-finished drawing survives tab switches
  for free.
- New smart component `pattern/workspace/workspace-sketch.component.ts` (standalone, OnPush,
  signals): a fixed-logical-size canvas (~1024×640, white background — filled explicitly so
  the export never ships a transparent PNG) wrapped by a small toolbar: pen/eraser toggle,
  2–3 stroke widths, a handful of colors (black/red/blue is plenty for annotation arrows),
  undo (snapshot stack), clear, and **"Attach to prompt"**.
- "Attach to prompt" exports `canvas.toDataURL('image/png')`, pushes a `PromptImage` into the
  store, and leaves the canvas as-is (attach twice = two revisions; the row thumbnails
  disambiguate). A small "attached ✓" flash confirms the action.

### `PromptContextStore`: the `images` slice

Third slice beside `snippets` and `references` (`shared/state/prompt-context.store.ts`):

- `PromptImage { mimeType: 'image/png' | 'image/jpeg', dataBase64: string, width: number,
  height: number, source: 'sketch' | 'paste', label: string }` — label defaults to
  `Sketch 1` / `Pasted image 1`.
- `addImage` / `removeImage` / `clear()` widened to empty all three slices (one "Clear", one
  context — same resolution as the references feature).
- Chat-tab rows in `speak-to-prompt.component.ts`, beneath "Selected code": an "Images
  (attached to the prompt)" group, each row a small thumbnail (`<img
  src="data:…">`, ~48 px), the label, and Remove. The chat dialog
  (`command-chat.component.ts`) gets matching rows to attach an image to a mid-session turn.

### Clipboard paste — the second source

A `paste` listener on the prompt textarea (speak-to-prompt) and the chat input (command-chat):
if `clipboardData` carries an image item, read it as a data URL and `addImage(source:
'paste')` instead of inserting text. This answers "can we copy-paste the image into the
prompt?" with yes — and generalizes the feature past sketches (OS screenshots, images from
design tools) for the cost of one event handler.

### Dispatch (backend)

The image never becomes prompt *text* — it travels beside it and lands as a content block:

- **Launch**: `LaunchAgentRequest` gains optional `attachments:
  [{ mimeType, dataBase64 }]` (plain JSON — no multipart endpoint needed at sketch sizes).
  `AgentLaunchService.launchChat` passes them through to `commandRegistry.chatSend`, and
  `ChatSession.sendUser` widens from text-only to
  `content: [{type:"text",…}, {type:"image","source":{type:"base64","media_type":…,"data":…}}…]`.
- **Live turn**: the `ChatCommandSocket` client→server envelope
  `{"type":"user","text"}` gains the same optional `attachments` array, feeding the same
  widened `sendUser`.
- **Guardrails**: server-side per-image cap (new config `qits.agent.attachment-max-bytes`,
  default 2 MiB) + magic-byte sniff (PNG/JPEG, sniffed type wins over the claimed mime —
  same policy as the screenshot idea's ingest), reject → 400 / socket error message rather
  than silently dropping a picture the user is about to reference ("as shown in the sketch").
- **Non-chat launches degrade honestly**: `mode=INTERACTIVE` and autonomous runs can't take
  inline blocks (argv prompt), so a launch with attachments in those modes is rejected with a
  clear message, and the launch UI disables "Launch as terminal session" while images are
  attached (tooltip: "images require the chat launch"). The file-drop follow-up lifts this.
- **Prompt text hint**: when attachments ride along, the serialized context gains a one-liner
  ("Attached: Sketch 1 — a rough drawing of the intended change") so the agent connects
  prose references to the image blocks.

Persistence falls out of the existing transcript flow: the user message (image block included)
is written to the session transcript, so a resumed/forked session retains what the agent saw.
The chat UI's user bubble should render the thumbnail from the transcript line rather than
showing a wall of base64 — a small renderer tweak in the chat markdown path.

## Implementation order

1. **Spike (half a day, de-risks everything)**: hand-feed a stream-json image block to
   `claude --print --input-format stream-json` inside a real workspace container and confirm
   the model sees the image. If the CLI envelope rejects image blocks (the one thin-docs risk),
   pivot the dispatch leg to the file-drop mechanism and keep every UI piece unchanged.
2. Store slice + Chat-tab rows + paste handler (pure frontend, testable without the tab).
3. Backend dispatch: `LaunchAgentRequest.attachments`, socket envelope, `sendUser` widening,
   caps + sniffing, bubble thumbnail rendering.
4. The Sketch tab itself (atrament canvas + toolbar) — deliberately last; paste-attachment
   already proves the pipeline end-to-end with any screenshot.

## Open questions

- **Transcript weight**: inline base64 in the transcript is fine at sketch sizes, but a
  paste-happy user attaching full-res screenshots pushes transcript lines toward MBs. Cap
  handles abuse; if it grates, client-side downscale-before-attach (long edge ≤ 1568 px — the
  model downscales past that anyway) is a cheap addition.
- **Does the sketch survive reload?** Within this feature: no (matches picked elements — the
  store is in-memory). The real answer is the sibling idea
  [refresh-resilient-prompt-building](refresh-resilient-prompt-building.md), which persists
  the whole prompt-composition state (canvas autosave included) per workspace; this feature
  ships without it.
- **Interactive/autonomous coverage**: is the file-drop follow-up (a
  `ContainerRuntime.writeFile` + path convention + gitignore/permission policy) actually
  needed, or is chat-only enough? Decide after usage; the degradation UX above keeps the gap
  visible instead of surprising.

## Non-goals

- No shape tools, layers, text boxes, or multi-page boards — this is a napkin, not a
  whiteboard. If real diagramming demand appears, that's an excalidraw-room discussion, not an
  extension of this canvas.
- No sketch persistence or gallery; a sketch's lifetime is the prompt it's attached to.
- No image storage on the qits host and no serving endpoint — the bytes go browser → qits →
  container stdin and live on only in the session transcript. (The screenshot idea's
  `CaptureArtifactStore` remains its own concern.)
- No changes to the picked-element or code-reference flows beyond sharing the panel and
  `clear()`.

## Testing sketch

- Store spec: `addImage`/`removeImage`/widened `clear()`; label auto-numbering.
- `speak-to-prompt` spec: image rows render with thumbnails; Remove updates the store;
  `launch()` sends `attachments` beside the serialized text context; terminal-session launch
  disabled while images attached.
- `command-chat` spec: paste event with an image item attaches instead of inserting text; a
  sent turn carries `attachments` in the socket payload.
- Backend: `ChatSession` unit test — `sendUser` with attachments emits one stream-json line
  whose `content` holds text + image blocks in order; `AgentControllerTest` — launch with an
  oversized / wrong-magic attachment → 400; interactive launch with attachments → 400.
- Sketch component spec: stroke → undo → clear state machine; export produces a PNG data URL
  with white background; attach pushes to the store.
- Manual (`/verify`, seed-webapp): draw an arrow on the Sketch tab, attach, launch a chat
  session, and confirm the agent's first response demonstrates it saw the drawing.
