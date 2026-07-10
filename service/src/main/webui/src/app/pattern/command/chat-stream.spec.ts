import { describe, expect, it } from 'vitest';

import { foldSidechains, linesToItems } from './chat-stream';

/** The wrapped persistence shape of an extracted transcript line. */
function transcriptLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    parentUuid: null,
    sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    isSidechain: false,
    timestamp: '2026-07-10T08:00:00.000Z',
    ...overrides,
  });
}

describe('linesToItems (extracted transcripts)', () => {
  it('folds a real user turn whose message.content is a plain string', () => {
    const items = linesToItems([
      transcriptLine({ type: 'user', message: { content: 'please fix the build' } }),
    ]);

    expect(items).toEqual([{ kind: 'user', text: 'please fix the build' }]);
  });

  it('still folds the live synthetic user echo and assistant blocks unchanged', () => {
    const items = linesToItems([
      JSON.stringify({ type: 'user', text: 'hi' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    ]);

    expect(items).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'hello' },
    ]);
  });

  it('captures the tool_use id so sidechain groups can anchor to their Task call', () => {
    const items = linesToItems([
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Task', id: 'toolu_123' }] },
      }),
    ]);

    expect(items).toEqual([{ kind: 'toolCall', text: 'Task', toolUseId: 'toolu_123' }]);
  });

  it('folds the synthetic qits_agent_meta line into an agentMeta item', () => {
    const items = linesToItems([
      transcriptLine({
        type: 'qits_agent_meta',
        agentId: 'a1b2',
        agentType: 'Explore',
        description: 'scan the tests',
        toolUseId: 'toolu_123',
      }),
    ]);

    expect(items).toEqual([
      { kind: 'agentMeta', text: 'Explore: scan the tests', agentId: 'a1b2', toolUseId: 'toolu_123' },
    ]);
  });

  it('stamps sidechain metadata onto items from sidechain lines', () => {
    const items = linesToItems([
      transcriptLine({
        type: 'assistant',
        isSidechain: true,
        agentId: 'a1b2',
        message: { content: [{ type: 'text', text: 'subagent says' }] },
      }),
    ]);

    expect(items).toEqual([
      { kind: 'assistant', text: 'subagent says', sidechain: true, agentId: 'a1b2' },
    ]);
  });

  it('drops transcript-only bookkeeping types', () => {
    const items = linesToItems([
      transcriptLine({ type: 'summary', summary: 'a summary' }),
      transcriptLine({ type: 'file-history-snapshot' }),
    ]);

    expect(items).toEqual([]);
  });
});

describe('foldSidechains', () => {
  it('passes a plain live stream through unchanged', () => {
    const items = linesToItems([
      JSON.stringify({ type: 'user', text: 'hi' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'yo' }] } }),
    ]);

    const entries = foldSidechains(items);

    expect(entries).toEqual([
      { kind: 'item', item: { kind: 'user', text: 'hi' } },
      { kind: 'item', item: { kind: 'assistant', text: 'yo' } },
    ]);
  });

  it('groups sidechain items and anchors them after the matching Task tool-call', () => {
    const items = linesToItems([
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Task', id: 'toolu_123' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'done' }] },
      }),
      transcriptLine({
        type: 'qits_agent_meta',
        agentId: 'a1b2',
        agentType: 'Explore',
        description: 'scan',
        toolUseId: 'toolu_123',
      }),
      transcriptLine({
        type: 'assistant',
        isSidechain: true,
        agentId: 'a1b2',
        message: { content: [{ type: 'text', text: 'inside the sidechain' }] },
      }),
    ]);

    const entries = foldSidechains(items);

    expect(entries.map((e) => e.kind)).toEqual(['item', 'group', 'item']);
    const group = entries[1] as Extract<(typeof entries)[number], { kind: 'group' }>;
    expect(group.label).toBe('Explore: scan');
    expect(group.agentId).toBe('a1b2');
    expect(group.items).toEqual([
      { kind: 'assistant', text: 'inside the sidechain', sidechain: true, agentId: 'a1b2' },
    ]);
  });

  it('appends a group whose anchor is missing at the end', () => {
    const items = linesToItems([
      JSON.stringify({ type: 'user', text: 'hi' }),
      transcriptLine({
        type: 'qits_agent_meta',
        agentId: 'zz',
        agentType: 'claude',
        description: 'orphan',
        toolUseId: 'toolu_gone',
      }),
      transcriptLine({
        type: 'assistant',
        isSidechain: true,
        agentId: 'zz',
        message: { content: [{ type: 'text', text: 'orphaned work' }] },
      }),
    ]);

    const entries = foldSidechains(items);

    expect(entries.map((e) => e.kind)).toEqual(['item', 'group']);
  });
});
