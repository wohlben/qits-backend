package eu.wohlben.qits.domain.agent.dto;

import java.time.Instant;
import java.util.List;

/**
 * One node of a workspace's agent-session tree: a session (not a command — resumes collapse onto
 * the session they continued), with fork children nested beneath it and the subagent sidechains it
 * spawned attached.
 *
 * <p>{@code messageCount} is null while the session has never been swept — a running session's
 * counts appear only after its post-exit transcript import. {@code newestCommandId} is the newest
 * command that drove the session (the row's navigation target).
 */
public record AgentSessionNodeDto(
    String sessionId,
    Instant firstRecordedAt,
    String forkedFromSessionId,
    Integer messageCount,
    String newestCommandId,
    List<AgentSubagentDto> subagents,
    List<AgentSessionNodeDto> children) {}
