package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.FrameworkDetectionService.DetectedProject;
import eu.wohlben.qits.domain.repository.control.WorkspaceFileAccess.Entry;
import eu.wohlben.qits.domain.repository.control.WorkspaceFileAccess.EntryType;
import eu.wohlben.qits.domain.repository.dto.DetectedProjectDto;
import eu.wohlben.qits.domain.repository.dto.DetectionDto;
import eu.wohlben.qits.domain.repository.dto.FileLinkDto;
import eu.wohlben.qits.domain.repository.dto.FrameworkMembershipDto;
import eu.wohlben.qits.domain.repository.dto.TestLinkDto;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Serves {@code GET .../{workspaceId}/detection}: the framework/project/test-link metadata the file
 * browser consumes, computed once over the container's live working tree. The pure classification
 * is {@link FrameworkDetectionService}; this orchestrator fetches the path list, layers the content
 * peeks it can't do (a pom's Quarkus label, a project's test runner) on top, resolves membership
 * and links, and returns the one {@link DetectionDto}. {@code /files} is left untouched.
 *
 * <p>Reading files through {@code docker exec} per request is slow, so results are cached per
 * workspace and validated per request against a cheap working-tree marker (same mechanism as {@link
 * ComponentMapService}) — detection depends on structural files the agent can create/delete without
 * a commit, so it must not be cached on the commit SHA. Known accepted staleness matches {@code
 * ComponentMapService}: a content edit to an already-untracked file moves neither {@code git
 * status} nor {@code git diff}.
 */
@ApplicationScoped
public class DetectionService {

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject WorkspaceService workspaceService;

  @Inject WorkspaceFileAccess access;

  @Inject FrameworkDetectionService detector;

  @Inject QitsConfigParser qitsConfigParser;

  @Inject WorkingTreeMarker workingTreeMarker;

  @org.eclipse.microprofile.config.inject.ConfigProperty(
      name = "qits.repositories.data-dir",
      defaultValue = "data/repositories")
  String dataDir;

  private record CachedDetection(String marker, DetectionDto detection) {}

  private final ConcurrentHashMap<String, CachedDetection> cache = new ConcurrentHashMap<>();

  private static final Pattern QUARKUS = Pattern.compile("quarkus", Pattern.CASE_INSENSITIVE);

  /**
   * The workspace's detection metadata, computed on demand. A merely-stopped container is
   * materialized by the same {@code ensureContainer} path every file read uses; a tree with no
   * recognised framework yields empty lists — never an error.
   */
  public DetectionDto detect(String repoId, String workspaceId) {
    validate(repoId, workspaceId);

    String key = repoId + "/" + workspaceId;
    String marker = workingTreeMarker.compute(repoId, workspaceId);
    CachedDetection cached = cache.get(key);
    if (cached != null && cached.marker().equals(marker)) {
      return cached.detection();
    }
    DetectionDto detection = scan(repoId, workspaceId);
    cache.put(key, new CachedDetection(marker, detection));
    return detection;
  }

  /** The container is gone with its working tree — whatever was scanned from it is stale. */
  void onContainerStopping(@Observes WorkspaceContainerStopping event) {
    cache.remove(event.repoId() + "/" + event.workspaceId());
  }

  private DetectionDto scan(String repoId, String workspaceId) {
    List<String> paths =
        access
            .git(repoId, workspaceId, "ls-files", "--cached", "--others", "--exclude-standard")
            .lines()
            .filter(line -> !line.isBlank())
            .distinct()
            .sorted()
            .toList();

    // Consult the repository's declared frameworks first (a .qits-config.yml override/hint), then
    // fall back to marker-based detection for everything not declared. Declared entries win on the
    // (kind, root) they name; markers fill in the rest.
    List<DetectedProject> projects = mergeDeclaredFrameworks(repoId, detector.detect(paths));

    // Content peeks, memoized per root within the request: a pom's Quarkus label and a TS project's
    // test runner. Both are one small read per detected root, not per file.
    Map<String, String> labelByProject = new HashMap<>();
    Map<String, String> runnerByRoot = new HashMap<>();

    List<DetectedProjectDto> projectDtos = new ArrayList<>();
    List<FrameworkMembershipDto> frameworks = new ArrayList<>();
    for (DetectedProject project : projects) {
      String id = project.descriptor().id();
      String label = label(repoId, workspaceId, project, labelByProject);
      projectDtos.add(new DetectedProjectDto(project.root(), id, label));
      frameworks.add(
          new FrameworkMembershipDto(
              id, project.root(), label, detector.memberPaths(project, paths)));
    }

    List<FileLinkDto> links = new ArrayList<>();
    for (String path : paths) {
      List<String> tests = detector.linkedTestsOf(path, projects, paths);
      if (tests.isEmpty()) {
        continue;
      }
      DetectedProject owner = detector.owningProject(path, projects);
      List<TestLinkDto> testLinks =
          tests.stream()
              .map(
                  t ->
                      new TestLinkDto(t, testKinds(repoId, workspaceId, t, projects, runnerByRoot)))
              .toList();
      links.add(new FileLinkDto(path, owner == null ? null : owner.root(), testLinks));
    }

    // The structural generation token, stamped so the client can render detection only against the
    // matching /files generation (WorkspaceTreeFingerprint.of over the same normalized path list).
    return new DetectionDto(projectDtos, frameworks, links, WorkspaceTreeFingerprint.of(paths));
  }

  /**
   * Prepends the repository's declared {@code frameworks[]} (from {@code .qits-config.yml} on the
   * main branch) to the marker-detected projects, deduped by {@code (kind, root)} so a declared
   * entry supersedes an identically-keyed detected one. Read from the bare origin (container-free);
   * an absent/invalid file or an unknown {@code kind} simply contributes nothing.
   */
  private List<DetectedProject> mergeDeclaredFrameworks(
      String repoId, List<DetectedProject> detected) {
    List<QitsConfig.FrameworkDecl> declared;
    try {
      var repo = repositoryRepository.findByIdOptional(repoId).orElse(null);
      if (repo == null) {
        return detected;
      }
      java.io.File origin = java.nio.file.Path.of(dataDir, repoId, "origin").toFile();
      declared = qitsConfigParser.readConfig(origin, repo.mainBranch).frameworks();
    } catch (RuntimeException e) {
      // A broken file must never break detection — fall back to marker-only.
      return detected;
    }
    if (declared.isEmpty()) {
      return detected;
    }

    List<DetectedProject> merged = new ArrayList<>();
    java.util.Set<String> seen = new java.util.HashSet<>();
    for (QitsConfig.FrameworkDecl decl : declared) {
      FrameworkDetectionService.Descriptor descriptor =
          FrameworkDetectionService.descriptorById(decl.kind());
      if (descriptor == null) {
        continue; // unknown kind — ignored (detection is a read path with no warning surface)
      }
      String root = normalizeRoot(decl.root());
      if (seen.add(descriptor.id() + " " + root)) {
        merged.add(new DetectedProject(root, descriptor));
      }
    }
    for (DetectedProject p : detected) {
      if (seen.add(p.descriptor().id() + " " + p.root())) {
        merged.add(p);
      }
    }
    return merged;
  }

  /** Normalize a declared framework root to the detector's convention ({@code ""} = repo root). */
  private static String normalizeRoot(String root) {
    if (root == null) {
      return "";
    }
    String r = root.trim();
    if (r.equals(".") || r.equals("/")) {
      return "";
    }
    while (r.startsWith("/")) {
      r = r.substring(1);
    }
    while (r.endsWith("/")) {
      r = r.substring(0, r.length() - 1);
    }
    return r;
  }

  /**
   * The framework's presentation label, refining a Java pom to "Java / Quarkus" via a content peek.
   */
  private String label(
      String repoId, String workspaceId, DetectedProject project, Map<String, String> memo) {
    if (!"java-quarkus".equals(project.descriptor().id())) {
      return project.descriptor().label();
    }
    return memo.computeIfAbsent(
        project.root(),
        root -> {
          String pom = root.isEmpty() ? "pom.xml" : root + "/pom.xml";
          return readIfPresent(repoId, workspaceId, pom)
                  .filter(c -> QUARKUS.matcher(c).find())
                  .isPresent()
              ? "Java / Quarkus"
              : project.descriptor().label();
        });
  }

  /**
   * The runner kind(s) of a test file. Java tests are {@code junit}; a {@code *.spec.ts} takes its
   * owning Angular project's runner, config-detected once per root (never a hardcoded default —
   * this repo's own SPA runs Vitest). A test owned by no known project falls back to {@code
   * unspecified}.
   */
  private List<String> testKinds(
      String repoId,
      String workspaceId,
      String testPath,
      List<DetectedProject> projects,
      Map<String, String> runnerByRoot) {
    DetectedProject owner = detector.owningProject(testPath, projects);
    if (owner != null && "java-quarkus".equals(owner.descriptor().id())) {
      return List.of("junit");
    }
    if (owner != null && "ts-angular".equals(owner.descriptor().id())) {
      return List.of(
          runnerByRoot.computeIfAbsent(
              owner.root(), root -> detectRunner(repoId, workspaceId, root)));
    }
    return List.of("unspecified");
  }

  /**
   * The test runner of a TS/Angular project, detected from config: the {@code angular.json} test
   * builder first, then the presence of a runner's config file at the project root. Emits an open
   * string id, or {@code unspecified} when nothing matches — never a canonical guess.
   */
  private String detectRunner(String repoId, String workspaceId, String root) {
    String angularJson = root.isEmpty() ? "angular.json" : root + "/angular.json";
    var content = readIfPresent(repoId, workspaceId, angularJson);
    if (content.isPresent()) {
      String c = content.get();
      if (c.contains("@angular/build:unit-test") || c.toLowerCase().contains("vitest")) {
        return "vitest";
      }
      if (c.contains(":karma") || c.toLowerCase().contains("karma")) {
        return "karma-jasmine";
      }
    }
    if (configPresent(repoId, workspaceId, root, "vitest.config")) {
      return "vitest";
    }
    if (configPresent(repoId, workspaceId, root, "playwright.config")) {
      return "playwright";
    }
    if (configPresent(repoId, workspaceId, root, "cypress.config")) {
      return "cypress";
    }
    if (configPresent(repoId, workspaceId, root, "karma.conf")) {
      return "karma-jasmine";
    }
    return "unspecified";
  }

  /**
   * Whether a {@code <base>.<ext>} config file exists at the project root, for the usual JS exts.
   */
  private boolean configPresent(String repoId, String workspaceId, String root, String base) {
    for (String ext : List.of("ts", "mts", "cts", "js", "mjs", "cjs")) {
      String rel = base + "." + ext;
      String full = root.isEmpty() ? rel : root + "/" + rel;
      Entry entry = access.stat(repoId, workspaceId, full);
      if (entry.type() == EntryType.FILE) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reads a file's text if it exists as a regular file; empty otherwise (missing or unreadable).
   */
  private java.util.Optional<String> readIfPresent(String repoId, String workspaceId, String path) {
    try {
      Entry entry = access.stat(repoId, workspaceId, path);
      if (entry.type() != EntryType.FILE) {
        return java.util.Optional.empty();
      }
      return java.util.Optional.of(
          new String(access.read(repoId, workspaceId, path), StandardCharsets.UTF_8));
    } catch (InternalServerErrorException e) {
      return java.util.Optional.empty();
    }
  }

  /** Same gate as every other workspace file read: rows exist, container materialized on demand. */
  private void validate(String repoId, String workspaceId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));
    workspaceRepository
        .findActiveByRepositoryAndWorkspaceId(repoId, workspaceId)
        .orElseThrow(() -> new NotFoundException("Workspace not found: " + workspaceId));
    workspaceService.ensureContainer(repoId, workspaceId);
  }
}
