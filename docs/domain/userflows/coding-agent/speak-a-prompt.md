# Speak a Prompt

## User Story

As a developer, I want to describe out loud what a worktree should accomplish and have that turned into a well-formed agent prompt, so that starting delegated work is as fast as saying it.

## Builds On

1. `worktree/propose-change`

## UI Flow

Every worktree has a **work-in-progress page** ("Work on it" from the branch tree, or "Speak a prompt" from the worktree's file browser). It shows the worktree's goal (preamble) and the speak-to-prompt widget:

1. **Record**: the browser captures microphone audio, detects utterances by silence, and shows a live input-level meter.
2. Each utterance is transcribed **on the server, fully locally** (no cloud speech service); text appears in an editable transcript while the user is still speaking.
3. **Refine into prompt**: a small model rewrites the raw transcript into a coherent coding-agent prompt (or the transcript is used as-is). The result is editable.
4. **Launch agent with this prompt**: the prompt seeds a repository-scoped agent chat in this worktree, and the user lands in the conversation.

## Processes

- `speech-transcriptions` — transcribe a recorded speech segment
- `repositories-repoId-worktrees-worktreeId-prompt-refinements` — rewrite the transcript into an agent prompt
- `repositories-repoId-worktrees-worktreeId-agents` — launch the seeded agent chat
