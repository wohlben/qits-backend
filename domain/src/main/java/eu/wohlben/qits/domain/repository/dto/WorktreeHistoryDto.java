package eu.wohlben.qits.domain.repository.dto;

import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import java.time.Instant;

/**
 * A worktree as a history list entry. Keyed by the surrogate {@code id} (not {@code worktreeId},
 * which is reusable once a worktree is resolved).
 */
public record WorktreeHistoryDto(
    Long id,
    String worktreeId,
    String parent,
    WorktreeStatus status,
    Instant createdAt,
    Instant resolvedAt) {}
