package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.command.mapper.CommandMapper;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.dto.WorktreeEventDto;
import eu.wohlben.qits.domain.repository.dto.WorktreeHistoryDetailDto;
import eu.wohlben.qits.domain.repository.dto.WorktreeHistoryDto;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.entity.WorktreeEvent;
import eu.wohlben.qits.domain.repository.persistence.WorktreeEventRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;

/**
 * Read/edit side of the worktree history: lists all worktrees (active + resolved) for a repository
 * and assembles a single worktree's full record — its narrative, event timeline, and the commands
 * that ran in it. Keyed by the surrogate id, since {@code worktreeId} is reusable once resolved.
 */
@ApplicationScoped
public class WorktreeHistoryService {

  @Inject WorktreeRepository worktreeRepository;

  @Inject WorktreeEventRepository worktreeEventRepository;

  @Inject CommandRepository commandRepository;

  @Inject CommandMapper commandMapper;

  @Transactional
  public List<WorktreeHistoryDto> list(String repoId) {
    return worktreeRepository.findByRepositoryId(repoId).stream()
        .map(
            wt ->
                new WorktreeHistoryDto(
                    wt.id, wt.worktreeId, wt.parent, wt.status, wt.createdAt, wt.resolvedAt))
        .toList();
  }

  @Transactional
  public WorktreeHistoryDetailDto get(String repoId, Long id) {
    Worktree worktree = requireWorktree(repoId, id);
    List<WorktreeEventDto> events =
        worktreeEventRepository.findByWorktreeOrderByAt(id).stream()
            .map(WorktreeHistoryService::toEventDto)
            .toList();
    var commands = commandRepository.findByWorktree(id).stream().map(commandMapper::toDto).toList();
    return new WorktreeHistoryDetailDto(
        worktree.id,
        worktree.worktreeId,
        worktree.parent,
        worktree.status,
        worktree.preamble,
        worktree.result,
        worktree.createdAt,
        worktree.resolvedAt,
        events,
        commands);
  }

  /** Edit the markdown narrative; null fields are left unchanged. */
  @Transactional
  public WorktreeHistoryDetailDto updateNarrative(
      String repoId, Long id, String preamble, String result) {
    Worktree worktree = requireWorktree(repoId, id);
    if (preamble != null) {
      worktree.preamble = preamble;
    }
    if (result != null) {
      worktree.result = result;
    }
    return get(repoId, id);
  }

  private Worktree requireWorktree(String repoId, Long id) {
    Worktree worktree = worktreeRepository.findById(id);
    if (worktree == null || !worktree.repository.id.equals(repoId)) {
      throw new NotFoundException("Worktree not found: " + id);
    }
    return worktree;
  }

  private static WorktreeEventDto toEventDto(WorktreeEvent e) {
    return new WorktreeEventDto(e.type, e.branch, e.parent, e.target, e.commit, e.note, e.at);
  }
}
