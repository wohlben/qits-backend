package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.GitExecutor;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Turns a raw speech-to-text transcript into a coherent coding-agent prompt by running a one-shot
 * Claude call on a small model. The refinement is ephemeral — it runs directly via {@link
 * ProcessExecutor} instead of the command registry, so it never shows up in command history. The
 * call runs in a neutral cwd (not the worktree) on purpose: loading the target repo's CLAUDE.md
 * would only add latency to a pure text-rewriting task; the worktree context the model needs
 * (branch, goal) is passed explicitly in the meta-prompt.
 */
@ApplicationScoped
public class PromptRefinementService {

  /** Worktree ids are path segments, so they must be strict slugs (mirrors WorktreeService). */
  private static final Pattern WORKTREE_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");

  private static final Duration TIMEOUT = Duration.ofSeconds(120);

  private static final String META_PROMPT =
      """
      You rewrite raw speech-to-text transcripts into prompts for an autonomous coding agent.

      The transcript below was dictated by a developer describing work to do in a git worktree.
      Worktree branch: %s
      Worktree goal (preamble):
      %s

      Rewrite the transcript into a clear, imperative task prompt for the coding agent:
      - Fix speech-recognition artifacts: misheard words, missing punctuation, filler words,
        false starts and self-corrections (keep only the corrected intent).
      - Preserve every technical detail (names, paths, constraints). Do not invent requirements
        or add steps the speaker did not ask for.
      - Structure: one summary sentence of the goal, then bullet points for specifics if any.
      - Output ONLY the rewritten prompt text - no commentary, no headings, no code fences.

      Transcript:
      %s
      """;

  @Inject ProcessExecutor processExecutor;

  @Inject WorktreeRepository worktreeRepository;

  @Inject GitExecutor git;

  @ConfigProperty(name = "qits.refinement.model", defaultValue = "haiku")
  String refinementModel;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  /** Refines {@code transcript} into a coding-agent prompt, contextualized by the worktree. */
  public String refine(String repoId, String worktreeId, String transcript) {
    if (transcript == null || transcript.isBlank()) {
      throw new BadRequestException("transcript is required");
    }
    if (!WORKTREE_ID_PATTERN.matcher(worktreeId == null ? "" : worktreeId).matches()) {
      throw new BadRequestException("Invalid worktree id: " + worktreeId);
    }

    String preamble = preambleFor(repoId, worktreeId);
    String branch = branchFor(repoId, worktreeId);

    String metaPrompt =
        META_PROMPT.formatted(
            branch, preamble == null || preamble.isBlank() ? "(none)" : preamble, transcript);
    LaunchSpec spec =
        CodingAgentFactory.ofType(AgentType.CLAUDE).model(refinementModel).run(metaPrompt);

    ProcessExecutor.Result result =
        processExecutor.exec(
            List.of("bash", "-c", spec.script()),
            Path.of(System.getProperty("user.home")),
            spec.environment(),
            TIMEOUT);

    if (result.timedOut()) {
      throw new InternalServerErrorException(
          "Prompt refinement timed out after " + TIMEOUT.toSeconds() + "s");
    }
    if (result.exitCode() != 0) {
      throw new InternalServerErrorException(
          "Prompt refinement failed (exit " + result.exitCode() + "): " + tail(result.stderr()));
    }
    String prompt = result.stdout().strip();
    if (prompt.isEmpty()) {
      throw new InternalServerErrorException("Prompt refinement produced no output");
    }
    return prompt;
  }

  /** The worktree's preamble, read in its own transaction; 404 if the worktree doesn't exist. */
  private String preambleFor(String repoId, String worktreeId) {
    return QuarkusTransaction.requiringNew()
        .call(
            () -> {
              Worktree worktree =
                  worktreeRepository
                      .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
                      .orElseThrow(
                          () -> new NotFoundException("Worktree not found: " + worktreeId));
              return worktree.preamble;
            });
  }

  /** The checkout's current branch, or the worktree id when no checkout exists on disk. */
  private String branchFor(String repoId, String worktreeId) {
    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId).toAbsolutePath();
    return Files.exists(worktreePath) ? git.getCurrentBranch(worktreePath) : worktreeId;
  }

  private static String tail(String text) {
    String stripped = text == null ? "" : text.strip();
    int max = 500;
    return stripped.length() <= max ? stripped : stripped.substring(stripped.length() - max);
  }
}
