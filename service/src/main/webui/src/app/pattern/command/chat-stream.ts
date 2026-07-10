/**
 * Shared helpers for rendering a Claude stream-json conversation. The backend sends one unified
 * stream of newline-delimited JSON lines — each event Claude emits plus a synthetic
 * `{"type":"user","text":…}` echo per user turn — used identically by the live chat (websocket) and
 * the finished-command replay (persisted log). This turns those raw lines into categorized chat
 * items; the transcript decides which categories to show.
 *
 * Extracted agent transcripts (the TRANSCRIPT log channel) carry the same event envelopes wrapped
 * with persistence metadata (`parentUuid`, `sessionId`, `isSidechain`, `agentId`, `timestamp`) and
 * real user turns whose `message.content` is a plain string — both tolerated here, so the same
 * renderer folds live streams and imported transcripts. Subagent sidechains are announced by a
 * synthetic `qits_agent_meta` line and grouped by {@link foldSidechains}.
 */

export type ChatItemKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'toolCall'
  | 'toolResult'
  | 'system'
  | 'agentMeta';

export interface ChatItem {
  kind: ChatItemKind;
  text: string;
  error?: boolean;
  /** True for subagent-sidechain lines of an extracted transcript. */
  sidechain?: boolean;
  /** The subagent id a sidechain line belongs to. */
  agentId?: string;
  /** On toolCall items: the tool_use id, anchoring a sidechain group to its Task call. */
  toolUseId?: string;
}

interface ContentBlock {
  type: string;
  id?: string;
  text?: string;
  thinking?: string;
  name?: string;
  content?: string | { type?: string; text?: string }[];
  is_error?: boolean;
}

interface StreamEvent {
  type: string;
  subtype?: string;
  model?: string;
  text?: string;
  result?: string;
  is_error?: boolean;
  message?: { content?: ContentBlock[] | string };
  // Transcript persistence metadata (absent on live stream lines).
  isSidechain?: boolean;
  agentId?: string;
  // qits_agent_meta fields (the synthetic sidechain label line the transcript import emits).
  agentType?: string;
  description?: string;
  toolUseId?: string;
}

const MAX_TOOL_RESULT_CHARS = 4000;

/** Fold raw JSON lines into categorized chat items, dropping only pure noise (hooks, rate limits). */
export function linesToItems(lines: string[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const line of lines) {
    let ev: StreamEvent;
    try {
      ev = JSON.parse(line) as StreamEvent;
    } catch {
      continue;
    }
    const before = out.length;
    switch (ev.type) {
      case 'user':
        if (typeof ev.text === 'string') {
          // The synthetic echo of the human's own turn (live chat).
          out.push({ kind: 'user', text: ev.text });
        } else if (typeof ev.message?.content === 'string') {
          // A real user turn as persisted in an extracted transcript.
          out.push({ kind: 'user', text: ev.message.content });
        } else {
          // Claude echoes tool results back as a `user` event with tool_result content.
          for (const block of ev.message?.content ?? []) {
            if (block.type === 'tool_result') {
              out.push({ kind: 'toolResult', text: toolResultText(block), error: block.is_error });
            }
          }
        }
        break;
      case 'assistant':
        if (typeof ev.message?.content === 'string') {
          out.push({ kind: 'assistant', text: ev.message.content });
          break;
        }
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            out.push({ kind: 'assistant', text: block.text });
          } else if (block.type === 'thinking' && (block.thinking || block.text)) {
            out.push({ kind: 'thinking', text: block.thinking ?? block.text ?? '' });
          } else if (block.type === 'tool_use') {
            out.push({ kind: 'toolCall', text: block.name ?? 'tool', toolUseId: block.id });
          }
        }
        break;
      case 'system':
        if (ev.subtype === 'init') {
          out.push({ kind: 'system', text: 'session ready' + (ev.model ? ' (' + ev.model + ')' : '') });
        }
        break;
      case 'result':
        // A successful result is redundant with the assistant text; surface only failures.
        if (ev.is_error || ev.subtype === 'error') {
          out.push({ kind: 'system', text: 'error: ' + (ev.result ?? ev.subtype ?? 'unknown'), error: true });
        }
        break;
      case 'session_closed':
        out.push({ kind: 'system', text: 'session ended' });
        break;
      case 'qits_agent_meta':
        // The transcript import's synthetic sidechain label: "agentType: description".
        out.push({
          kind: 'agentMeta',
          text: [ev.agentType, ev.description].filter(Boolean).join(': ') || 'subagent',
          agentId: ev.agentId,
          toolUseId: ev.toolUseId,
        });
        break;
      default:
        // rate_limit_event, hook lifecycle events, transcript-only bookkeeping (summary,
        // file-history-snapshot, …) — dropped.
        break;
    }
    // Stamp transcript sidechain metadata on whatever the line produced.
    if (ev.isSidechain && ev.agentId) {
      for (let i = before; i < out.length; i++) {
        out[i] = { ...out[i], sidechain: true, agentId: ev.agentId };
      }
    }
  }
  return out;
}

function toolResultText(block: ContentBlock): string {
  const raw =
    typeof block.content === 'string'
      ? block.content
      : (block.content ?? [])
          .map((c) => c.text ?? '')
          .join('')
          .trim();
  return raw.length > MAX_TOOL_RESULT_CHARS ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + '…' : raw;
}

/** One row of a folded transcript: a main-thread item, or a collapsible subagent sidechain. */
export type TranscriptEntry =
  | { kind: 'item'; item: ChatItem }
  | { kind: 'group'; agentId: string; label: string; items: ChatItem[] };

/**
 * Groups sidechain items by subagent and anchors each group after the Task tool-call that spawned
 * it (matched by `toolUseId` from the group's `agentMeta` line). Groups whose anchor isn't found
 * append at the end; a plain live stream (no sidechains) passes through unchanged.
 */
export function foldSidechains(items: ChatItem[]): TranscriptEntry[] {
  const groups = new Map<string, { label: string; toolUseId?: string; items: ChatItem[] }>();
  const main: ChatItem[] = [];
  for (const item of items) {
    if (item.kind === 'agentMeta' && item.agentId) {
      groups.set(item.agentId, { label: item.text, toolUseId: item.toolUseId, items: [] });
    } else if (item.sidechain && item.agentId) {
      let group = groups.get(item.agentId);
      if (!group) {
        group = { label: 'subagent ' + item.agentId, items: [] };
        groups.set(item.agentId, group);
      }
      group.items.push(item);
    } else {
      main.push(item);
    }
  }
  const entries: TranscriptEntry[] = [];
  const anchored = new Set<string>();
  for (const item of main) {
    entries.push({ kind: 'item', item });
    if (item.kind === 'toolCall' && item.toolUseId) {
      for (const [agentId, group] of groups) {
        if (!anchored.has(agentId) && group.toolUseId === item.toolUseId) {
          anchored.add(agentId);
          entries.push({ kind: 'group', agentId, label: group.label, items: group.items });
        }
      }
    }
  }
  for (const [agentId, group] of groups) {
    if (!anchored.has(agentId)) {
      entries.push({ kind: 'group', agentId, label: group.label, items: group.items });
    }
  }
  return entries;
}

/** Whether a raw line marks the end of a turn (so a "thinking" indicator can be cleared). */
export function isTurnEnd(line: string): boolean {
  try {
    return (JSON.parse(line) as StreamEvent).type === 'result';
  } catch {
    return false;
  }
}
