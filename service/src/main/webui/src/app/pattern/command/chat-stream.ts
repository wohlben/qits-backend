/**
 * Shared helpers for rendering a Claude stream-json conversation. The backend sends one unified
 * stream of newline-delimited JSON lines — each event Claude emits plus a synthetic
 * `{"type":"user","text":…}` echo per user turn — used identically by the live chat (websocket) and
 * the finished-command replay (persisted log). This turns those raw lines into categorized chat
 * items; the transcript decides which categories to show.
 */

export type ChatItemKind = 'user' | 'assistant' | 'thinking' | 'toolCall' | 'toolResult' | 'system';

export interface ChatItem {
  kind: ChatItemKind;
  text: string;
  error?: boolean;
}

interface ContentBlock {
  type: string;
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
  message?: { content?: ContentBlock[] };
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
    switch (ev.type) {
      case 'user':
        if (typeof ev.text === 'string') {
          // The synthetic echo of the human's own turn.
          out.push({ kind: 'user', text: ev.text });
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
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            out.push({ kind: 'assistant', text: block.text });
          } else if (block.type === 'thinking' && (block.thinking || block.text)) {
            out.push({ kind: 'thinking', text: block.thinking ?? block.text ?? '' });
          } else if (block.type === 'tool_use') {
            out.push({ kind: 'toolCall', text: block.name ?? 'tool' });
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
      default:
        // rate_limit_event, hook lifecycle events, etc. — dropped.
        break;
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

/** Whether a raw line marks the end of a turn (so a "thinking" indicator can be cleared). */
export function isTurnEnd(line: string): boolean {
  try {
    return (JSON.parse(line) as StreamEvent).type === 'result';
  } catch {
    return false;
  }
}
