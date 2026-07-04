package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.InternalServerErrorException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * {@link WorktreeFileAccess} backed by {@code docker exec} into the worktree's container, so the
 * browser reads the container's actual live working tree ({@code /workspace}), uncommitted changes
 * included. The sibling of {@link WorktreeService}'s {@code containerGit} — it resolves the
 * container deterministically via {@link ContainerRuntime#containerName} and runs {@code
 * find}/{@code cat}/ {@code git} inside it.
 *
 * <p>Every command runs with workdir {@code /workspace} and worktree-relative paths, prefixed
 * {@code ./} when handed to {@code find} so a leading-dash filename can't be misread as a flag.
 * File content bypasses {@link ContainerRuntime#exec}'s {@code String} result (which line-joins and
 * re-encodes, corrupting binary bytes and trailing newlines) and reads the {@code docker exec}
 * process's raw stdout instead.
 */
@ApplicationScoped
public class ContainerFileAccess implements WorktreeFileAccess {

  @Inject ContainerRuntime containers;

  @Override
  public String git(String repoId, String worktreeId, String... args) {
    String container = containers.containerName(worktreeId, repoId);
    String[] argv = new String[args.length + 1];
    argv[0] = "git";
    System.arraycopy(args, 0, argv, 1, args.length);
    ContainerRuntime.ExecResult result = containers.exec(container, "/workspace", Map.of(), argv);
    if (result.exitCode() != 0) {
      throw new InternalServerErrorException(
          "Container git failed ["
              + result.exitCode()
              + "]: "
              + String.join(" ", argv)
              + "\n"
              + result.output());
    }
    return result.output();
  }

  @Override
  public Entry stat(String repoId, String worktreeId, String path) {
    String container = containers.containerName(worktreeId, repoId);
    ContainerRuntime.ExecResult result =
        containers.exec(
            container,
            "/workspace",
            Map.of(),
            "find",
            "./" + path,
            "-maxdepth",
            "0",
            "-printf",
            "%y\t%s\n");
    if (result.exitCode() != 0) {
      return new Entry(path, EntryType.MISSING, 0, 0);
    }
    String line = result.output().lines().filter(l -> !l.isBlank()).findFirst().orElse(null);
    if (line == null) {
      return new Entry(path, EntryType.MISSING, 0, 0);
    }
    String[] parts = line.split("\t", 2);
    EntryType type = typeOf(parts.length > 0 ? parts[0] : "");
    long size = 0;
    if (parts.length > 1) {
      try {
        size = Long.parseLong(parts[1].trim());
      } catch (NumberFormatException ignored) {
        // leave size 0
      }
    }
    return new Entry(path, type, size, 0);
  }

  @Override
  public List<Entry> list(String repoId, String worktreeId, String dir) {
    String container = containers.containerName(worktreeId, repoId);
    ContainerRuntime.ExecResult result =
        containers.exec(
            container,
            "/workspace",
            Map.of(),
            "find",
            "./" + dir,
            "-maxdepth",
            "2",
            "-mindepth",
            "1",
            "-printf",
            "%d\t%y\t%s\t%p\n");
    if (result.exitCode() != 0) {
      throw new InternalServerErrorException("Failed to list directory: " + result.output());
    }
    return parseFindListing(result.output());
  }

  @Override
  public int childCount(String repoId, String worktreeId, String dir) {
    String container = containers.containerName(worktreeId, repoId);
    ContainerRuntime.ExecResult result =
        containers.exec(
            container,
            "/workspace",
            Map.of(),
            "find",
            "./" + dir,
            "-maxdepth",
            "1",
            "-mindepth",
            "1",
            "-printf",
            "x\n");
    if (result.exitCode() != 0) {
      return 0;
    }
    return (int) result.output().lines().filter(l -> !l.isBlank()).count();
  }

  @Override
  public boolean resolvesInsideRoot(String repoId, String worktreeId, String path) {
    String container = containers.containerName(worktreeId, repoId);
    // Canonicalize both the worktree root and the target (all symlinks followed, -e requires
    // existence) and confirm the target stays under the root. Comparing the resolved root rather
    // than
    // a literal "/workspace" keeps this correct under the test fake, where the container is a host
    // clone at a different absolute path.
    ContainerRuntime.ExecResult result =
        containers.exec(
            container, "/workspace", Map.of(), "realpath", "-e", "--", ".", "./" + path);
    if (result.exitCode() != 0) {
      return false; // missing path, or a broken/looping symlink
    }
    List<String> lines = result.output().lines().filter(l -> !l.isBlank()).toList();
    if (lines.size() < 2) {
      return false;
    }
    String rootReal = lines.get(0);
    String pathReal = lines.get(1);
    return pathReal.equals(rootReal) || pathReal.startsWith(rootReal + "/");
  }

  @Override
  public byte[] read(String repoId, String worktreeId, String path) {
    String container = containers.containerName(worktreeId, repoId);
    List<String> argv =
        new ArrayList<>(containers.execArgv(container, false, "/workspace", Map.of()));
    argv.add("cat");
    argv.add("--");
    argv.add(path);
    ProcessBuilder pb = new ProcessBuilder(argv);
    // Keep stdout clean (no merged stderr) and drain stderr so a full pipe can't deadlock the read.
    pb.redirectError(ProcessBuilder.Redirect.DISCARD);
    try {
      Process p = pb.start();
      p.getOutputStream().close(); // cat reads its file arg, never stdin
      byte[] bytes;
      try (var in = p.getInputStream()) {
        bytes = in.readAllBytes();
      }
      p.waitFor();
      return bytes;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new InternalServerErrorException("Interrupted reading file: " + path);
    } catch (Exception e) {
      throw new InternalServerErrorException("Failed to read file: " + e.getMessage());
    }
  }

  /**
   * Parses {@code find <dir> -maxdepth 2 -mindepth 1 -printf '%d\t%y\t%s\t%p\n'} output into the
   * immediate children (depth 1). Each depth-1 directory's {@code childCount} is the number of
   * depth-2 entries nested under it. Leading {@code ./} (from the {@code find ./<dir>} start point)
   * is stripped so paths are worktree-root-relative. Pure and static so it's unit-testable without
   * a container.
   */
  static List<Entry> parseFindListing(String output) {
    List<Entry> depthOne = new ArrayList<>();
    List<String> depthTwoPaths = new ArrayList<>();
    for (String raw : output.split("\n")) {
      if (raw.isBlank()) {
        continue;
      }
      String[] parts = raw.split("\t", 4);
      if (parts.length < 4) {
        continue;
      }
      int depth;
      try {
        depth = Integer.parseInt(parts[0].trim());
      } catch (NumberFormatException e) {
        continue;
      }
      EntryType type = typeOf(parts[1]);
      long size = 0;
      try {
        size = Long.parseLong(parts[2].trim());
      } catch (NumberFormatException ignored) {
        // leave size 0
      }
      String path = stripDotSlash(parts[3]);
      if (depth == 1) {
        depthOne.add(new Entry(path, type, size, 0));
      } else if (depth == 2) {
        depthTwoPaths.add(path);
      }
    }
    List<Entry> result = new ArrayList<>(depthOne.size());
    for (Entry e : depthOne) {
      if (e.type() == EntryType.DIRECTORY) {
        String prefix = e.path() + "/";
        int count = 0;
        for (String child : depthTwoPaths) {
          if (child.startsWith(prefix)) {
            count++;
          }
        }
        result.add(new Entry(e.path(), e.type(), e.size(), count));
      } else {
        result.add(e);
      }
    }
    return result;
  }

  private static String stripDotSlash(String path) {
    return path.startsWith("./") ? path.substring(2) : path;
  }

  private static EntryType typeOf(String findType) {
    if (findType == null || findType.isEmpty()) {
      return EntryType.OTHER;
    }
    return switch (findType.charAt(0)) {
      case 'f' -> EntryType.FILE;
      case 'd' -> EntryType.DIRECTORY;
      case 'l' -> EntryType.SYMLINK;
      default -> EntryType.OTHER;
    };
  }
}
