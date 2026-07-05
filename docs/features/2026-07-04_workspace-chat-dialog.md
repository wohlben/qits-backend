# Workspace detail: persistent chat session in a full-size dialog

## Introduction

The workspace detail route (the file browser) currently links away to the WIP route ("Speak a
prompt") to start working with an agent — leaving the files behind exactly when you'd want them
in view. This idea brings that experience **onto the detail route itself**: a button opens a
**full-size dialog** containing the same speak/refine/launch flow and the native chat, and the
chat session is **persistent** — closing the dialog hides it, reopening re-attaches to the same
running conversation. The dialog is explicitly the *first iteration* ("for now"); the likely
evolution (split pane, references feeding the prompt) is noted but out of scope.

Related/dependent plans:

- Lives on the [workspace-file-browser](./2026-07-02_workspace-file-browser.md) route;
  that doc's reference cache ("collects, doesn't submit") was built to eventually feed this
  chat — this feature creates the surface where that hand-off will land, without wiring it yet.
- Encapsulates the [speak-to-prompt](./2026-07-02_speak-to-prompt.md) flow
  (`SpeakToPromptComponent`) — the WIP route stays as-is for now and shares the components.
- The chat itself is the [stream-json chat](./2026-07-01_stream-json-chat.md): a
  registry-tracked, **re-attachable** `Command` of kind `CHAT`
  (`command-chat.component.ts`, WebSocket ring-replay + live). Persistence across dialog
  open/close is exactly the re-attach mechanism that already exists — no new backend.

## Behaviour

- A **"Chat"** button in the workspace detail header (it replaced the "Speak a prompt" link;
  the WIP route stays reachable by URL only, kept for prototyping) opens a near-fullscreen
  dialog (`ZardDialogService`, ~`90vw`/`90vh`, single instance, backdrop click disabled so an
  unsent transcript isn't lost).
- The repository detail page's per-workspace **"Work on it"** button now opens the workspace
  detail route (previously the WIP route).
- **No session yet** → the dialog shows the WIP content: the workspace goal (preamble) and
  `<app-speak-to-prompt>`; launching creates the chat and the dialog switches to the
  transcript. A plain typed prompt (skip the mic) should also be possible — speak-to-prompt
  already ends in an editable prompt, so this is free if the component allows starting from
  an empty transcript.
- **Session running** → the dialog opens straight into `<app-command-chat>` attached to that
  command. The WebSocket replays the scrollback ring, then streams live — the conversation
  continues exactly where it was.
- **Closing the dialog does not end the chat.** The agent keeps working server-side (it's a
  registry command); the dialog is just a viewport. A small indicator on the Chat button
  (e.g. a dot when a session is running) tells the user there's a live conversation behind it.
- **Terminating** stays available inside the dialog (a Terminate button in the dialog's own
  header — the chat component itself has no terminate), after which the dialog falls back to
  speak-to-prompt.

## Session discovery & state

Which chat "belongs" to this workspace must survive dialog close, route re-entry, and page
reload — so it can't live in the dialog component:

- `CommandDto` already carries `workspaceId`, `kind` and `status`. The dialog's owning
  component resolves the current session as *the most recent `CHAT` command for this workspace
  that is still running* from the commands list query (`['commands']`, already polled/refreshed
  elsewhere). No new endpoint, no localStorage — the registry is the source of truth, which
  also means a chat started from the WIP route or the Commands page shows up here too.
- If multiple running chats exist for one workspace (possible via the Commands page), pick the
  newest; the Commands page remains the place to see all of them. Noted as an accepted
  simplification for this iteration.
- Finished (non-running) chats are *not* auto-opened — the dialog is for the live session;
  history stays on the Commands page (`command-chat-log` replay).

## Implementation sketch

- **Extract, don't duplicate**: the WIP page's body (preamble + `SpeakToPromptComponent`) is
  already component-shaped; the dialog template composes `@if (session()) { <app-command-chat> }
  @else { preamble + speak-to-prompt }`. The WIP route keeps working unchanged during the
  transition.
- The dialog is opened from the workspace-detail page via `ZardDialogService` with an inline
  `<ng-template>` (same pattern as the advanced filter dialog). Full-size styling via the
  dialog's custom class; the transcript pane scrolls, the input row is pinned.
- `command-chat.component.ts` already handles queue-until-open and auto-reconnect, so
  re-attach on reopen is its normal connect path — the dialog only needs to pass the command
  id.
- **Dialog lifecycle vs socket**: closing the dialog destroys the component and its socket
  (fine — reopen replays the ring). If the destroy/reconnect churn proves annoying, an
  alternative is keeping the component alive and hiding the dialog (CSS), but start with the
  simple destroy/re-attach since the ring replay makes it lossless.

## Explicitly deferred ("to be improved after")

- **References → prompt**: attaching the file browser's collected `path:line` chips to a chat
  turn (the original purpose of the reference cache). The dialog puts chat and references on
  the same screen for the first time; the wiring is its own follow-up.
- **Split-pane instead of dialog**: chat docked beside the file tree/viewer so code and
  conversation are visible simultaneously — the probable end state; the dialog is the cheap
  first step.
- Launching with workspace context (open file, current filters) folded into the seed prompt.
- Multiple named sessions per workspace.

## Open questions (settled)

- Should the "Speak a prompt" header link be removed immediately? **Removed** — the dialog
  replaces it; the WIP route itself stays reachable by URL for future prototyping.
- Does opening the dialog while an agent is mid-turn need any guard? No — ring replay +
  line-oriented events mean attaching mid-turn renders correctly by construction (same as the
  Commands page re-attach today).

## Testing sketch

- Workspace-detail page spec: button opens the dialog; with a mocked running `CHAT` command for
  this workspace the chat component is composed with that id; without one, speak-to-prompt is
  shown; running-session indicator reflects the commands query.
- Session-resolution util/spec: newest-running-chat-for-workspace selection (multiple chats,
  finished chats excluded, other workspaces' chats excluded).
- Reopen flow (component test): open → close → reopen keeps the same command id (no relaunch),
  asserting persistence is re-attach, not restart.
- Manual/browser verification: launch from the dialog, close, watch the button indicator,
  reopen mid-agent-turn and confirm the transcript replays and continues live.
