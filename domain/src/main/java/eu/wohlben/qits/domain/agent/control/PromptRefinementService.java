package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.entity.Workspace;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Turns a raw speech-to-text transcript into a coherent coding-agent prompt by running a one-shot
 * agent call on a small model. The refinement is ephemeral — it runs as a {@code <runtime> exec}
 * into the workspace's container (via {@link ProcessExecutor}, so stdout/stderr stay separate and
 * it never shows up in command history), reusing the container's agent binary and the shared
 * credential volume. The container is provisioned on demand ({@link
 * WorkspaceService#ensureContainer}) and the workspace context the model needs (branch, goal) is
 * passed explicitly in the meta-prompt.
 */
@ApplicationScoped
public class PromptRefinementService {

  /** Workspace ids are path segments, so they must be strict slugs (mirrors WorkspaceService). */
  private static final Pattern WORKSPACE_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");

  private static final Duration TIMEOUT = Duration.ofSeconds(120);

  private static final String META_PROMPT =
      """
      You rewrite raw speech-to-text transcripts into prompts for an autonomous coding agent.

      The transcript below was dictated by a developer describing work to do in a workspace.
      Workspace branch: %s
      Workspace goal (preamble):
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

  @Inject WorkspaceRepository workspaceRepository;

  @Inject WorkspaceService workspaceService;

  @Inject ContainerRuntime containers;

  /**
   * The refinement model, as a harness-specific id or alias. Unset (the default) falls back per
   * harness: Claude's cheap tier ({@code haiku}); Kimi runs its own default model (it has no
   * Claude-style aliases).
   */
  @ConfigProperty(name = "qits.refinement.model")
  Optional<String> refinementModel;

  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  @Inject AgentTypeResolver agentTypeResolver;

  /** Refines {@code transcript} into a coding-agent prompt, contextualized by the workspace. */
  public String refine(String repoId, String workspaceId, String transcript) {
    if (transcript == null || transcript.isBlank()) {
      throw new BadRequestException("transcript is required");
    }
    if (!WORKSPACE_ID_PATTERN.matcher(workspaceId == null ? "" : workspaceId).matches()) {
      throw new BadRequestException("Invalid workspace id: " + workspaceId);
    }

    // Prompt refinement is a default-scoped surface (no per-launch tab choice): resolve the
    // qits-wide default harness once.
    AgentType agentType = agentTypeResolver.resolve(null);

    WorkspaceContext context = workspaceContext(repoId, workspaceId);
    // Provision the container on demand — the refinement runs the agent inside it, using the
    // shared credential volume, so a stopped container is re-materialized rather than failing.
    workspaceService.ensureContainer(repoId, workspaceId);

    String metaPrompt =
        META_PROMPT.formatted(
            context.branch(),
            context.preamble() == null || context.preamble().isBlank()
                ? "(none)"
                : context.preamble(),
            transcript);
    // Plain-text output: refinement consumes stdout verbatim, so Kimi's stream-json default must
    // not apply. The model id is harness-specific; unset means Claude's haiku, Kimi's default.
    CodingAgent refinementAgent = CodingAgentFactory.ofType(agentType).plainTextOutput();
    String model =
        refinementModel
            .filter(m -> !m.isBlank())
            .orElse(agentType == AgentType.CLAUDE ? "haiku" : null);
    if (model != null) {
      refinementAgent.model(model);
    }
    LaunchSpec spec = refinementAgent.run(metaPrompt);

    // Run inside the workspace container: docker exec -w /workspace -e HOME=<claude-mount> … bash
    // -lc
    // <agent>. Driving it through ProcessExecutor (rather than ContainerRuntime.exec) keeps stdout
    // separate from stderr — the refined prompt is stdout only — and preserves timeout handling.
    Map<String, String> env = new HashMap<>(spec.environment());
    if (claudeMount != null && !claudeMount.isBlank()) {
      if (agentType == AgentType.CLAUDE) {
        env.put("HOME", claudeMount);
      }
      // Kimi Code's data root is already set at the container level via KIMI_CODE_HOME; no overlay
      // needed for refinement.
    }
    String container = containers.containerName(workspaceId, repoId);
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

  private record WorkspaceContext(String branch, String preamble) {}

  /**
   * The workspace's branch and preamble, read in one transaction; 404 if the workspace doesn't
   * exist. The branch comes from the stored column (there is no host checkout to read it from); it
   * falls back to the workspace id for a row that predates the stored branch.
   */
  private WorkspaceContext workspaceContext(String repoId, String workspaceId) {
    return QuarkusTransaction.requiringNew()
        .call(
            () -> {
              Workspace workspace =
                  workspaceRepository
                      .findActiveByRepositoryAndWorkspaceId(repoId, workspaceId)
                      .orElseThrow(
                          () -> new NotFoundException("Workspace not found: " + workspaceId));
              String branch =
                  workspace.branch == null || workspace.branch.isBlank()
                      ? workspaceId
                      : workspace.branch;
              return new WorkspaceContext(branch, workspace.preamble);
            });
  }

  private static String tail(String text) {
    String stripped = text == null ? "" : text.strip();
    int max = 500;
    return stripped.length() <= max ? stripped : stripped.substring(stripped.length() - max);
  }
}
