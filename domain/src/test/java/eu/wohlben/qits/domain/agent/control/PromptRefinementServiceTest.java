package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class PromptRefinementServiceTest {

  /** Records the executed command and plays back a canned result — no real process spawns. */
  static class FakeProcessExecutor extends ProcessExecutor {
    List<String> lastCommand;
    Path lastCwd;
    Result next = new Result(0, "refined prompt", "", false);

    @Override
    public Result exec(List<String> command, Path cwd, Map<String, String> env, Duration timeout) {
      this.lastCommand = command;
      this.lastCwd = cwd;
      return next;
    }
  }

  @Inject PromptRefinementService service;

  FakeProcessExecutor executor;

  String repoId;

  @BeforeEach
  public void setUp() {
    executor = new FakeProcessExecutor();
    QuarkusMock.installMockForType(executor, ProcessExecutor.class);
    repoId = seedWorktree();
  }

  @Transactional
  String seedWorktree() {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "test project";
    project.persist();

    Repository repository = new Repository();
    repository.id = UUID.randomUUID().toString();
    repository.url = "https://example.com/repo.git";
    repository.project = project;
    repository.persist();

    Worktree worktree = new Worktree();
    worktree.worktreeId = "wt-feature";
    worktree.repository = repository;
    worktree.preamble = "Add a health endpoint";
    worktree.persist();
    return repository.id;
  }

  @Test
  public void buildsAHaikuOneShotContainingTranscriptAndPreamble() {
    String prompt = service.refine(repoId, "wt-feature", "umm add a healthcheck please");

    assertEquals("refined prompt", prompt);
    assertEquals(List.of("bash", "-c").subList(0, 2), executor.lastCommand.subList(0, 2));
    String script = executor.lastCommand.get(2);
    assertTrue(script.startsWith("claude -p "), script);
    assertTrue(script.contains("--model 'haiku'"), script);
    assertTrue(script.contains("umm add a healthcheck please"), script);
    assertTrue(script.contains("Add a health endpoint"), script);
    // No checkout exists in tests, so the branch context falls back to the worktree id.
    assertTrue(script.contains("Worktree branch: wt-feature"), script);
    // Neutral cwd — never the worktree (would pull the target repo's CLAUDE.md into context).
    assertEquals(Path.of(System.getProperty("user.home")), executor.lastCwd);
  }

  @Test
  public void trimsTheModelOutput() {
    executor.next = new ProcessExecutor.Result(0, "  refined \n", "", false);

    assertEquals("refined", service.refine(repoId, "wt-feature", "hi"));
  }

  @Test
  public void blankTranscriptIsRejected() {
    assertThrows(BadRequestException.class, () -> service.refine(repoId, "wt-feature", "  "));
  }

  @Test
  public void invalidWorktreeIdIsRejected() {
    assertThrows(BadRequestException.class, () -> service.refine(repoId, "../etc", "hi"));
  }

  @Test
  public void unknownWorktreeIsNotFound() {
    assertThrows(NotFoundException.class, () -> service.refine(repoId, "no-such-wt", "hi"));
  }

  @Test
  public void nonZeroExitBecomesAServerError() {
    executor.next = new ProcessExecutor.Result(1, "", "not logged in", false);

    InternalServerErrorException e =
        assertThrows(
            InternalServerErrorException.class, () -> service.refine(repoId, "wt-feature", "hi"));
    assertTrue(e.getMessage().contains("not logged in"), e.getMessage());
  }

  @Test
  public void timeoutBecomesAServerError() {
    executor.next = new ProcessExecutor.Result(137, "", "", true);

    assertThrows(
        InternalServerErrorException.class, () -> service.refine(repoId, "wt-feature", "hi"));
  }

  @Test
  public void emptyOutputBecomesAServerError() {
    executor.next = new ProcessExecutor.Result(0, "   ", "", false);

    assertThrows(
        InternalServerErrorException.class, () -> service.refine(repoId, "wt-feature", "hi"));
  }
}
