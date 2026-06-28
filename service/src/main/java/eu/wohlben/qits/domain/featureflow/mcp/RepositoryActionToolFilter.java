package eu.wohlben.qits.domain.featureflow.mcp;

import io.quarkiverse.mcp.server.McpConnection;
import io.quarkiverse.mcp.server.ToolFilter;
import io.quarkiverse.mcp.server.ToolManager.ToolInfo;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Set;

/**
 * Conditionally exposes the repository-scoped action tools: they are listed only when the
 * connection carries an {@code X-QITS-Repository} header (see {@link RepositoryScope}). An unscoped
 * session connecting to the actions server therefore sees only the global-action tools, and a
 * repo-scoped session additionally sees the repository ones — so the tool surface matches what the
 * session can actually do.
 */
@ApplicationScoped
public class RepositoryActionToolFilter implements ToolFilter {

  /** The tools that only make sense for a repository-scoped session. */
  private static final Set<String> REPOSITORY_SCOPED_TOOLS =
      Set.of(
          "listRepositoryActions",
          "getRepositoryAction",
          "createRepositoryAction",
          "updateRepositoryAction",
          "deleteRepositoryAction");

  @Inject RepositoryScope repositoryScope;

  @Override
  public boolean test(ToolInfo tool, McpConnection connection) {
    if (!REPOSITORY_SCOPED_TOOLS.contains(tool.name())) {
      return true;
    }
    // Fail closed: if the request scope can't be read (e.g. no active request context), treat the
    // session as unscoped and hide the repository tools rather than letting the listing error.
    try {
      return repositoryScope.hasRepository();
    } catch (RuntimeException e) {
      return false;
    }
  }
}
