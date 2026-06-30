package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.featureflow.control.RepositoryActionService;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.dto.WorktreeHistoryDetailDto;
import eu.wohlben.qits.domain.repository.dto.WorktreeHistoryDto;
import eu.wohlben.qits.domain.repository.entity.WorktreeEventType;
import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Verifies worktree soft-delete against a real cloned-fixture repo: cleanup/discard keeps the row
 * as history (with status, events and result), worktree ids can be reused after resolution, and a
 * worktree that ran a command can still be discarded — both the worktree and its command persist.
 */
@QuarkusTest
@TestProfile(WorktreeHistoryServiceTest.TestProfile.class)
public class WorktreeHistoryServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-history-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject WorktreeService worktreeService;

  @Inject WorktreeHistoryService worktreeHistoryService;

  @Inject RepositoryActionService repositoryActionService;

  @Inject CommandService commandService;

  private String clonedRepo() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("History Project", null);
    return repositoryService.cloneRepository(fixtureUrl, null, project).id;
  }

  private WorktreeHistoryDto historyFor(String repoId, String worktreeId) {
    return worktreeHistoryService.list(repoId).stream()
        .filter(h -> worktreeId.equals(h.worktreeId()))
        .findFirst()
        .orElseThrow();
  }

  private boolean activeContains(String repoId, String worktreeId) {
    return worktreeService.listWorktrees(repoId).stream()
        .anyMatch(w -> worktreeId.equals(w.worktreeId()));
  }

  @Test
  public void discardKeepsTheRowAsAbandonedHistory() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", "build the feature");
    assertTrue(activeContains(repoId, "feat"));

    worktreeService.discardWorktree(repoId, "feat", "did not work out");

    assertFalse(activeContains(repoId, "feat"), "discarded worktree leaves the active list");
    WorktreeHistoryDetailDto detail =
        worktreeHistoryService.get(repoId, historyFor(repoId, "feat").id());
    assertEquals(WorktreeStatus.ABANDONED, detail.status());
    assertEquals("build the feature", detail.preamble());
    assertEquals("did not work out", detail.result());
    assertTrue(detail.events().stream().anyMatch(e -> e.type() == WorktreeEventType.CREATED));
    assertTrue(detail.events().stream().anyMatch(e -> e.type() == WorktreeEventType.ABANDONED));
  }

  @Test
  public void cleanupResolvesAsIntegrated() throws Exception {
    String repoId = clonedRepo();
    // A freshly forked worktree has no commits ahead of master and a clean tree → cleanable.
    worktreeService.createWorktree(repoId, "ff", "master", "ff", null);

    worktreeService.cleanupBranch(repoId, "ff", "merged upstream");

    assertFalse(activeContains(repoId, "ff"));
    assertEquals(WorktreeStatus.INTEGRATED, historyFor(repoId, "ff").status());
  }

  @Test
  public void worktreeIdCanBeReusedAfterResolution() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);
    worktreeService.discardWorktree(repoId, "feat", null);

    // Reuse the id — only an ACTIVE duplicate is rejected, so this succeeds.
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);

    assertTrue(activeContains(repoId, "feat"));
    long featRows =
        worktreeHistoryService.list(repoId).stream()
            .filter(h -> "feat".equals(h.worktreeId()))
            .count();
    assertEquals(2, featRows, "both the resolved and the new worktree share the id in history");
  }

  @Test
  public void aWorktreeThatRanACommandCanBeDiscardedAndBothPersist() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);
    String actionId =
        repositoryActionService.create(
                repoId, "echo", null, "echo hi", null, false, ActionVariant.SHELL, null)
            .id;
    commandService.launchAndAwait(repoId, "feat", actionId);

    // Previously the command's FK pinned the worktree row and this threw a constraint violation.
    worktreeService.discardWorktree(repoId, "feat", null);

    WorktreeHistoryDetailDto detail =
        worktreeHistoryService.get(repoId, historyFor(repoId, "feat").id());
    assertEquals(WorktreeStatus.ABANDONED, detail.status());
    assertEquals(1, detail.commands().size(), "the command stays associated with the worktree");
  }
}
