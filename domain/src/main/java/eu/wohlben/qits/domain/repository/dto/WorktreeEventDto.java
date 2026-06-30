package eu.wohlben.qits.domain.repository.dto;

import eu.wohlben.qits.domain.repository.entity.WorktreeEventType;
import java.time.Instant;

/** One entry in a worktree's history timeline. */
public record WorktreeEventDto(
    WorktreeEventType type,
    String branch,
    String parent,
    String target,
    String commit,
    String note,
    Instant at) {}
