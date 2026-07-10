package eu.wohlben.qits.domain.agent.dto;

import java.time.Instant;

/**
 * One subagent sidechain of an agent session — spawned automatically by the coding agent, so
 * visually secondary to the sessions an operator drove. Labels come from the sidechain's meta
 * ({@code agentType: description}); counts from the transcript sweep's aggregation.
 */
public record AgentSubagentDto(
    String agentId,
    String agentType,
    String description,
    int messageCount,
    Instant firstTimestamp) {}
