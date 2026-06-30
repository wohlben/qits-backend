package eu.wohlben.qits.domain.repository.dto;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import java.time.Instant;
import java.util.List;

/** A worktree's full history: its narrative, event timeline, and the commands that ran in it. */
public record WorktreeHistoryDetailDto(
    Long id,
    String worktreeId,
    String parent,
    WorktreeStatus status,
    String preamble,
    String result,
    Instant createdAt,
    Instant resolvedAt,
    List<WorktreeEventDto> events,
    List<CommandDto> commands) {}
