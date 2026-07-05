package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.InternalServerErrorException;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

/**
 * The default lazy-directory strategy: gitignored directories are the lazy boundary, so {@code
 * node_modules/}, {@code dist/}, build output and the like become collapsed stubs instead of
 * flooding the file list. This keeps the out-of-the-box tree cheap (the expensive dirs are present
 * as openable stubs rather than being silently dropped by {@code --exclude-standard}).
 *
 * <p>Implemented with {@code git ls-files --others --ignored --exclude-standard --directory
 * --no-empty-directory}: the {@code --directory} flag makes git collapse a wholly-ignored directory
 * into a single {@code node_modules/} entry <em>without recursing into it</em> — exactly the cheap
 * lazy boundary we want. Trailing-slash entries are directories; individually-ignored files (no
 * trailing slash) are left hidden, as today.
 */
@ApplicationScoped
public class GitignoreLazyDirectoryStrategy implements LazyDirectoryStrategy {

  @Override
  public String id() {
    return "gitignore";
  }

  @Override
  public List<String> lazyDirectories(
      String repoId, String workspaceId, WorkspaceFileAccess access) {
    String output;
    try {
      output =
          access.git(
              repoId,
              workspaceId,
              "ls-files",
              "--others",
              "--ignored",
              "--exclude-standard",
              "--directory",
              "--no-empty-directory");
    } catch (Exception e) {
      throw new InternalServerErrorException(
          "Failed to resolve lazy directories: " + e.getMessage());
    }
    return output
        .lines()
        .filter(line -> line.endsWith("/"))
        .map(line -> line.substring(0, line.length() - 1))
        .filter(line -> !line.isBlank())
        .distinct()
        .sorted()
        .toList();
  }
}
