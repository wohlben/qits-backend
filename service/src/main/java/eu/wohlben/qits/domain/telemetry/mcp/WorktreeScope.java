package eu.wohlben.qits.domain.telemetry.mcp;

import eu.wohlben.qits.domain.error.BadRequestException;
import io.vertx.core.http.HttpServerRequest;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import java.util.Optional;

/**
 * Resolves the worktree a "repository" MCP session is optionally scoped to — the third scope
 * dimension after project and repository, added for the telemetry tools: a worktree-launched agent
 * session carries {@code ?worktreeId=} in its MCP URL (see {@code AgentLaunchService}) and may only
 * query that worktree's telemetry. Taken from the request, never a tool argument, so a session
 * can't widen its own scope.
 *
 * <p>Mirrors {@link eu.wohlben.qits.domain.featureflow.mcp.RepositoryScope}; the scope is optional
 * — {@link #worktreeId()} returns empty when absent, which the {@link TelemetryToolFilter} uses to
 * hide the telemetry tools from sessions that aren't pinned to a worktree.
 */
@RequestScoped
public class WorktreeScope {

  /** Header carrying the worktree id the connection is scoped to. */
  public static final String WORKTREE_HEADER = "X-QITS-Worktree";

  /** Query-parameter fallback when a client cannot set a custom header. */
  public static final String WORKTREE_QUERY_PARAM = "worktreeId";

  @Inject HttpServerRequest request;

  /** The scoped worktree id, or empty when the connection didn't supply one. */
  public Optional<String> worktreeId() {
    String id = request.getHeader(WORKTREE_HEADER);
    if (id == null || id.isBlank()) {
      id = request.getParam(WORKTREE_QUERY_PARAM);
    }
    return (id == null || id.isBlank()) ? Optional.empty() : Optional.of(id.trim());
  }

  /** Whether this session is scoped to a worktree. */
  public boolean hasWorktree() {
    return worktreeId().isPresent();
  }

  /** The scoped worktree id, or throws when the connection didn't supply one. */
  public String requireWorktreeId() {
    return worktreeId()
        .orElseThrow(
            () ->
                new BadRequestException(
                    "This MCP session is not scoped to a worktree. Connect with the '"
                        + WORKTREE_HEADER
                        + "' header (or '?"
                        + WORKTREE_QUERY_PARAM
                        + "=' query parameter) set to a worktree id."));
  }
}
