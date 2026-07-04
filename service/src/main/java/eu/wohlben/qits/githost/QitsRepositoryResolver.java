package eu.wohlben.qits.githost;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.eclipse.jgit.errors.RepositoryNotFoundException;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.storage.file.FileRepositoryBuilder;
import org.eclipse.jgit.transport.resolver.RepositoryResolver;

/**
 * Maps a {@code /git/<repoId>} request to the repository's bare origin on disk ({@code
 * <data-dir>/<repoId>/origin}), the same layout {@code RepositoryService} clones into. The repo id
 * is validated to a strict slug so nothing traversal-shaped (a {@code /} or {@code ..}) can escape
 * the data dir; an unknown id surfaces as a 404. This is the only mapping the in-process JGit
 * server performs — it serves the origins exactly as they sit on disk and never mutates them.
 */
public class QitsRepositoryResolver implements RepositoryResolver<HttpServletRequest> {

  /** Repo ids are UUIDs; allow only their character set, no path separators or leading dash. */
  private static final String REPO_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9-]{0,63}";

  private final String dataDir;

  QitsRepositoryResolver(String dataDir) {
    this.dataDir = dataDir;
  }

  @Override
  public Repository open(HttpServletRequest req, String name) throws RepositoryNotFoundException {
    if (name == null || !name.matches(REPO_ID_PATTERN)) {
      throw new RepositoryNotFoundException(name);
    }
    Path origin = Path.of(dataDir, name, "origin");
    if (!Files.isDirectory(origin)) {
      throw new RepositoryNotFoundException(name);
    }
    try {
      return new FileRepositoryBuilder().setGitDir(origin.toFile()).setMustExist(true).build();
    } catch (IOException e) {
      throw new RepositoryNotFoundException(name, e);
    }
  }
}
