package eu.wohlben.qits.domain.featureflow.mcp;

import eu.wohlben.qits.domain.error.BadRequestException;
import io.vertx.core.http.HttpServerRequest;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import java.util.Optional;

/**
 * Resolves the repository an "actions" MCP session is optionally scoped to. The actions server runs
 * <em>unscoped</em> by default (global-action management); when a connection sends the {@code
 * X-QITS-Repository} header it additionally manages that one repository's actions. The id is taken
 * from the request, never a tool argument, so a session can't widen its own scope.
 *
 * <p>Mirrors {@link eu.wohlben.qits.domain.repository.mcp.ProjectScope}, but the scope is optional
 * — {@link #repositoryId()} returns empty when no header is present, which the {@link
 * RepositoryActionToolFilter} uses to hide the repository-scoped tools.
 */
@RequestScoped
public class RepositoryScope {

  /** Header carrying the repository id the connection is scoped to. */
  public static final String REPOSITORY_HEADER = "X-QITS-Repository";

  /** Query-parameter fallback when a client cannot set a custom header. */
  public static final String REPOSITORY_QUERY_PARAM = "repositoryId";

  @Inject HttpServerRequest request;

  /** The scoped repository id, or empty when the connection didn't supply one. */
  public Optional<String> repositoryId() {
    String id = request.getHeader(REPOSITORY_HEADER);
    if (id == null || id.isBlank()) {
      id = request.getParam(REPOSITORY_QUERY_PARAM);
    }
    return (id == null || id.isBlank()) ? Optional.empty() : Optional.of(id.trim());
  }

  /** Whether this session is scoped to a repository. */
  public boolean hasRepository() {
    return repositoryId().isPresent();
  }

  /** The scoped repository id, or throws when the connection didn't supply one. */
  public String requireRepositoryId() {
    return repositoryId()
        .orElseThrow(
            () ->
                new BadRequestException(
                    "This MCP session is not scoped to a repository. Connect with the '"
                        + REPOSITORY_HEADER
                        + "' header (or '?"
                        + REPOSITORY_QUERY_PARAM
                        + "=' query parameter) set to a repository id."));
  }
}
