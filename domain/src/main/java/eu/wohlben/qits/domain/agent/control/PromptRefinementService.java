package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Turns a raw speech-to-text transcript into a coherent coding-agent prompt by running a one-shot
 * Claude call on a small model. The refinement is ephemeral — it runs as a {@code <runtime> exec}
 * into the worktree's container (via {@link ProcessExecutor}, so stdout/stderr stay separate and it
 * never shows up in command history), reusing the container's {@code claude} binary and the shared
 * credential volume. The container is provisioned on demand ({@link
 * WorktreeService#ensureContainer}) and the worktree context the model needs (branch, goal) is
 * passed explicitly in the meta-prompt.
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

  @Inject WorktreeService worktreeService;

  @Inject ContainerRuntime containers;

  @ConfigProperty(name = "qits.refinement.model", defaultValue = "haiku")
  String refinementModel;

  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  /** Refines {@code transcript} into a coding-agent prompt, contextualized by the worktree. */
  public String refine(String repoId, String worktreeId, String transcript) {
    if (transcript == null || transcript.isBlank()) {
      throw new BadRequestException("transcript is required");
    }
    if (!WORKTREE_ID_PATTERN.matcher(worktreeId == null ? "" : worktreeId).matches()) {
      throw new BadRequestException("Invalid worktree id: " + worktreeId);
    }

    WorktreeContext context = worktreeContext(repoId, worktreeId);
    // Provision the container on demand — the refinement runs claude inside it, using the shared
    // credential volume, so a stopped container is re-materialized rather than failing.
    worktreeService.ensureContainer(repoId, worktreeId);

    String metaPrompt =
        META_PROMPT.formatted(
            context.branch(),
            context.preamble() == null || context.preamble().isBlank()
                ? "(none)"
                : context.preamble(),
            transcript);
    LaunchSpec spec =
        CodingAgentFactory.ofType(AgentType.CLAUDE).model(refinementModel).run(metaPrompt);

    // Run inside the worktree container: docker exec -w /workspace -e HOME=<claude-mount> … bash
    // -lc
    // <claude>. Driving it through ProcessExecutor (rather than ContainerRuntime.exec) keeps stdout
    // separate from stderr — the refined prompt is stdout only — and preserves timeout handling.
    Map<String, String> env = new HashMap<>(spec.environment());
    if (claudeMount != null && !claudeMount.isBlank()) {
      env.put("HOME", claudeMount);
    }
    String container = containers.containerName(worktreeId, repoId);
    List<String> argv = new ArrayList<>(containers.execArgv(container, false, "/workspace", env));
    argv.add("bash");
    argv.add("-lc");
    argv.add(spec.script());

    ProcessExecutor.Result result =
        processExecutor.exec(argv, Path.of(System.getProperty("user.home")), Map.of(), TIMEOUT);

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

  private record WorktreeContext(String branch, String preamble) {}

  /**
   * The worktree's branch and preamble, read in one transaction; 404 if the worktree doesn't exist.
   * The branch comes from the stored column (there is no host checkout to read it from); it falls
   * back to the worktree id for a row that predates the stored branch.
   */
  private WorktreeContext worktreeContext(String repoId, String worktreeId) {
    return QuarkusTransaction.requiringNew()
        .call(
            () -> {
              Worktree worktree =
                  worktreeRepository
                      .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
                      .orElseThrow(
                          () -> new NotFoundException("Worktree not found: " + worktreeId));
              String branch =
                  worktree.branch == null || worktree.branch.isBlank()
                      ? worktreeId
                      : worktree.branch;
              return new WorktreeContext(branch, worktree.preamble);
            });
  }

  private static String tail(String text) {
    String stripped = text == null ? "" : text.strip();
    int max = 500;
    return stripped.length() <= max ? stripped : stripped.substring(stripped.length() - max);
  }
}
