package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Unit test for the default gitignore-based lazy-directory boundary (no Quarkus/CDI needed). */
class GitignoreLazyDirectoryStrategyTest {

  private final GitExecutor git = new GitExecutor();
  private final GitignoreLazyDirectoryStrategy strategy = new GitignoreLazyDirectoryStrategy();

  @TempDir Path root;

  /**
   * A minimal {@link WorktreeFileAccess} whose {@code git} shells real git in the temp repo — the
   * strategy only ever calls {@code git}, so the other primitives are unsupported. Stands in for
   * the container-backed {@link ContainerFileAccess} without a docker (or CDI) around.
   */
  private final WorktreeFileAccess access =
      new WorktreeFileAccess() {
        @Override
        public String git(String repoId, String worktreeId, String... args) {
          String[] argv = new String[args.length + 1];
          argv[0] = "git";
          System.arraycopy(args, 0, argv, 1, args.length);
          try {
            return git.exec(root.toFile(), argv);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        }

        @Override
        public Entry stat(String repoId, String worktreeId, String path) {
          throw new UnsupportedOperationException();
        }

        @Override
        public List<Entry> list(String repoId, String worktreeId, String dir) {
          throw new UnsupportedOperationException();
        }

        @Override
        public int childCount(String repoId, String worktreeId, String dir) {
          throw new UnsupportedOperationException();
        }

        @Override
        public boolean resolvesInsideRoot(String repoId, String worktreeId, String path) {
          throw new UnsupportedOperationException();
        }

        @Override
        public byte[] read(String repoId, String worktreeId, String path) {
          throw new UnsupportedOperationException();
        }
      };

  @BeforeEach
  void initRepo() throws Exception {
    git.exec(root.toFile(), "git", "init");
  }

  @Test
  void returnsIgnoredDirectoriesAsTheLazyBoundarySorted() throws Exception {
    Files.writeString(root.resolve(".gitignore"), "node_modules/\ndist/\n");
    Files.createDirectories(root.resolve("node_modules/pkg"));
    Files.writeString(root.resolve("node_modules/pkg/a.js"), "x");
    Files.createDirectories(root.resolve("dist"));
    Files.writeString(root.resolve("dist/b.js"), "y");
    Files.writeString(root.resolve("keep.ts"), "z");

    assertEquals(List.of("dist", "node_modules"), strategy.lazyDirectories("repo", "wt", access));
  }

  @Test
  void collapsesAWhollyIgnoredDirectoryToASingleEntryWithoutRecursing() throws Exception {
    Files.writeString(root.resolve(".gitignore"), "node_modules/\n");
    Files.createDirectories(root.resolve("node_modules/a/b/c"));
    Files.writeString(root.resolve("node_modules/a/b/c/deep.js"), "x");

    List<String> dirs = strategy.lazyDirectories("repo", "wt", access);

    // --directory collapses the whole ignored tree to one stub — nested dirs are NOT enumerated
    assertEquals(List.of("node_modules"), dirs);
    assertFalse(dirs.stream().anyMatch(d -> d.startsWith("node_modules/")));
  }

  @Test
  void ignoresIndividuallyIgnoredFilesAndEmptyDirectories() throws Exception {
    Files.writeString(root.resolve(".gitignore"), "*.log\nbuild/\n");
    Files.writeString(root.resolve("stray.log"), "l");
    Files.createDirectories(root.resolve("build")); // empty → --no-empty-directory drops it

    List<String> dirs = strategy.lazyDirectories("repo", "wt", access);

    // an ignored *file* is not a lazy dir; an empty ignored dir is dropped
    assertTrue(dirs.isEmpty(), () -> "expected no lazy dirs but got " + dirs);
  }

  @Test
  void reportsItsConfigId() {
    assertEquals("gitignore", strategy.id());
  }
}
