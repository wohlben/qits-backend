package eu.wohlben.qits.domain.command.dto;

import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import java.time.Instant;

/**
 * One entry of a command's ordered agent-session list — the last entry is the command's current
 * session.
 *
 * @param sessionId the agent session UUID
 * @param source how the session entered the list (pinned at launch, resumed, forked, or
 *     hook-reported after an in-TUI switch)
 * @param forkedFromSessionId on forked entries, the session this one branched from
 * @param transcriptPath the hook-reported transcript JSONL path (container-side), if reported
 * @param recordedAt when the entry was pinned or reported
 */
public record AgentSessionRefDto(
    String sessionId,
    AgentSessionSource source,
    String forkedFromSessionId,
    String transcriptPath,
    Instant recordedAt) {}
