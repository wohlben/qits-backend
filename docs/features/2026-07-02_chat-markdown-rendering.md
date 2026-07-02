# Markdown rendering for chat messages

## Introduction

The native Claude chat renders a conversation as chat bubbles — the human's turns and Claude's
responses. Until now both were rendered as **plain text** (`{{ item.text }}` with `whitespace-pre-wrap`),
so Claude's markdown-formatted answers (headings, lists, fenced code, tables, links) showed up as raw
markdown source. This feature renders both sides of the conversation as formatted HTML.

Related plans:
- Extends the [stream-json chat](2026-07-01_stream-json-chat.md): the chat items it produces
  (`ChatItem { kind, text }`) are unchanged; only how the `user`/`assistant` bubbles present `text`
  changed. Live chat and finished-command replay share the same transcript component, so both render
  markdown identically.

## What was built

**A presentational `MarkdownComponent`** (`ui/components/markdown/markdown.component.ts`,
`<app-markdown [text]="…" />`). It parses a markdown string with [`marked`](https://marked.js.org/)
(GFM + `breaks: true`, synchronous `async: false`) and binds the result via `[innerHTML]`. It never
bypasses Angular's sanitizer — the `[innerHTML]` binding runs the parsed HTML through Angular's
built-in `DomSanitizer`, which strips scripts, event handlers, and `javascript:` URLs. No `marked`
extensions and no `DOMPurify` are needed.

**Styling that works on both bubble colors.** Emulated view encapsulation can't reach nodes inserted
through `[innerHTML]`, so the component uses `ViewEncapsulation.None` with every rule namespaced under
a `.qits-md` wrapper class. Borders, code/pre backgrounds, blockquote rules, and table cell borders
use `currentColor` (via `color-mix(… currentColor …)`), so the same styles read correctly on the light
**user** bubble (`bg-primary` / `text-primary-foreground`) and the muted **assistant** bubble.

**Wired into the transcript.** `pattern/command/chat-transcript.component.ts` now renders the `user`
and `assistant` bubbles through `<app-markdown>` instead of plain interpolation (the
`whitespace-pre-wrap` class was dropped from those two bubbles — `marked` handles whitespace). The
richer rows (`thinking`, `toolCall`, `toolResult`, `system`) are untouched and stay plain text/mono.

**Streaming is event-level, not token-level.** Each assistant text block arrives as a whole
stream-json event and becomes one bubble, so markdown always parses against complete text — there is
no risk of rendering half-formed markdown mid-token.

## Dependency

- `marked` added to `service/src/main/webui/package.json`. It lands in the lazy-loaded commands route
  chunk (the chat only loads there), not the initial bundle.

## Tests

`ui/components/markdown/markdown.component.spec.ts` covers inline formatting (`**bold**`, `` `code` ``),
block elements (headings, lists, fenced code), and sanitization (a `<script>` payload is stripped while
its surrounding text survives).
