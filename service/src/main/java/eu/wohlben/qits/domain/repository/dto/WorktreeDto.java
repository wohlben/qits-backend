package eu.wohlben.qits.domain.repository.dto;

public record WorktreeDto(
    String worktreeId,
    String parent,
    String branch
) {}
