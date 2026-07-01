package eu.wohlben.qits.domain.command.dto;

import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import java.time.Instant;

/**
 * A command flattened for the Commands UX — what's active and where it came from.
 *
 * @param repoId the repository the worktree belongs to
 * @param worktreeId the worktree the process runs in
 * @param branch the branch checked out at launch
 * @param commitHash the full commit SHA checked out at launch
 * @param shortCommitHash the abbreviated commit SHA, for display
 * @param actionId the resolved action's id
 * @param actionName the resolved action's name
 * @param status the lifecycle state
 * @param exitCode the process exit code once finished (null while running)
 * @param interactive whether a human attaches a terminal to it
 */
public record CommandDto(
    String id,
    String repoId,
    String worktreeId,
    String branch,
    String commitHash,
    String shortCommitHash,
    String actionId,
    String actionName,
    CommandStatus status,
    Integer exitCode,
    boolean interactive,
    CommandKind kind,
    Instant launchedAt,
    Instant finishedAt) {}
