package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.repository.control.FrameworkDetectionService.DetectedProject;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the pure framework detector — a Java port of {@code detect-frameworks.spec.ts},
 * case-for-case, so the backend classification stays byte-for-byte what the frontend used to
 * compute (nested detection, deepest-root ownership, the CamelCase-prefix test binding, the fuzzy
 * {@code [A-Z]*} folding matrix, and membership resolution).
 */
class FrameworkDetectionServiceTest {

  private final FrameworkDetectionService service = new FrameworkDetectionService();

  /** The (id, root) pairs of a detection result, sorted, for compact assertions. */
  private static List<String> shape(List<DetectedProject> projects) {
    return projects.stream().map(p -> p.descriptor().id() + "@" + p.root()).sorted().toList();
  }

  // ---- detectFrameworks ----------------------------------------------------------------------

  @Test
  void detectsNestedJavaAndAngularEachAtTheParentDirOfItsMarker() {
    List<String> paths =
        List.of(
            "pom.xml",
            "domain/pom.xml",
            "service/pom.xml",
            "service/src/main/webui/angular.json",
            "service/src/main/webui/package.json",
            "service/src/main/webui/src/app/x.ts",
            "README.md");
    assertEquals(
        List.of(
            "java-quarkus@",
            "java-quarkus@domain",
            "java-quarkus@service",
            "ts-angular@service/src/main/webui"),
        shape(service.detect(paths)));
  }

  @Test
  void doesNotDetectAngularFromALonePackageJson() {
    assertEquals(List.of(), service.detect(List.of("pkg/package.json", "pkg/src/index.ts")));
  }

  @Test
  void detectsADocsDirOnlyWhenItContainsAMarkdownAndSurfacesMultipleDocsDirs() {
    assertEquals(List.of(), shape(service.detect(List.of("docs/notes.txt"))));
    assertEquals(
        List.of("docs@docs", "docs@service/docs"),
        shape(service.detect(List.of("docs/plan.md", "service/docs/guide.md"))));
  }

  // ---- owningProject -------------------------------------------------------------------------

  @Test
  void picksTheDeepestRootThatPrefixesThePath() {
    List<DetectedProject> projects =
        service.detect(
            List.of(
                "pom.xml",
                "service/pom.xml",
                "service/src/main/webui/angular.json",
                "docs/plan.md"));
    assertEquals(
        "ts-angular",
        service.owningProject("service/src/main/webui/src/app/x.ts", projects).descriptor().id());
    DetectedProject javaOwner = service.owningProject("service/src/main/java/Foo.java", projects);
    assertEquals("service", javaOwner.root());
    assertEquals("java-quarkus", javaOwner.descriptor().id());
    assertEquals("", service.owningProject("pom.xml", projects).root());
    assertEquals("docs", service.owningProject("docs/plan.md", projects).descriptor().id());
  }

  @Test
  void returnsNullForAPathOwnedByNoProject() {
    assertNull(service.owningProject("x.ts", List.of()));
  }

  // ---- memberPaths (the ported frameworkToRules + client evaluation) -------------------------

  @Test
  void resolvesAngularMembershipScopedByRoot() {
    String root = "service/src/main/webui";
    List<String> paths =
        List.of(
            root + "/package.json",
            root + "/angular.json",
            root + "/tsconfig.json",
            root + "/tsconfig.app.json",
            root + "/src/app/x.ts",
            root + "/public/favicon.ico",
            root + "/README.md", // not a member
            "pom.xml"); // not a member (outside root)
    DetectedProject angular =
        service.detect(paths).stream()
            .filter(p -> p.descriptor().id().equals("ts-angular"))
            .findFirst()
            .orElseThrow();
    // membership is a set; production passes a sorted ls-files list, so compare sorted
    assertEquals(
        sorted(
            root + "/angular.json",
            root + "/package.json",
            root + "/public/favicon.ico",
            root + "/src/app/x.ts",
            root + "/tsconfig.app.json",
            root + "/tsconfig.json"),
        sorted(service.memberPaths(angular, paths)));
  }

  @Test
  void resolvesJavaMembershipAtRepoRoot() {
    List<String> paths =
        List.of(
            "pom.xml",
            "src/main/java/com/App.java",
            "src/test/java/com/AppTest.java",
            "src/main/resources/application.properties",
            "src/test/resources/fixture.txt",
            "README.md"); // not a member
    DetectedProject java =
        service.detect(paths).stream()
            .filter(p -> p.descriptor().id().equals("java-quarkus"))
            .findFirst()
            .orElseThrow();
    assertEquals(
        sorted(
            "pom.xml",
            "src/main/java/com/App.java",
            "src/main/resources/application.properties",
            "src/test/java/com/AppTest.java",
            "src/test/resources/fixture.txt"),
        sorted(service.memberPaths(java, paths)));
  }

  // ---- linkedTestsOf / linkedSourcesOf (the shared primitive) --------------------------------

  @Test
  void linkedTestsOfAndSourcesOfBasics() {
    List<String> paths =
        List.of(
            "pom.xml",
            "src/main/java/com/App.java",
            "src/test/java/com/AppTest.java",
            "src/test/java/com/OrphanTest.java",
            "w/angular.json",
            "w/src/foo.ts",
            "w/src/foo.spec.ts");
    List<DetectedProject> projects = service.detect(paths);

    assertEquals(
        List.of("src/test/java/com/AppTest.java"),
        service.linkedTestsOf("src/main/java/com/App.java", projects, paths));
    assertEquals(
        List.of("w/src/foo.spec.ts"), service.linkedTestsOf("w/src/foo.ts", projects, paths));
    // a test is not a source of tests
    assertEquals(
        List.of(), service.linkedTestsOf("src/test/java/com/AppTest.java", projects, paths));

    assertEquals(
        List.of("w/src/foo.ts"), service.linkedSourcesOf("w/src/foo.spec.ts", projects, paths));
    assertEquals(
        List.of("src/main/java/com/App.java"),
        service.linkedSourcesOf("src/test/java/com/AppTest.java", projects, paths));
    assertEquals(List.of(), service.linkedSourcesOf("src/main/java/com/App.java", projects, paths));
    // an orphan test resolves to no existing source
    assertEquals(
        List.of(), service.linkedSourcesOf("src/test/java/com/OrphanTest.java", projects, paths));
  }

  @Test
  void handlesQualifiedTestNamesBackToTheBaseSource() {
    List<String> p =
        List.of(
            "pom.xml",
            "src/main/java/com/TheFile.java",
            "src/test/java/com/TheFileTest.java",
            "src/test/java/com/TheFileSpecialCaseTest.java",
            "src/test/java/com/TheFileRecordingIT.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(
        sorted(
            "src/test/java/com/TheFileRecordingIT.java",
            "src/test/java/com/TheFileSpecialCaseTest.java",
            "src/test/java/com/TheFileTest.java"),
        sorted(service.linkedTestsOf("src/main/java/com/TheFile.java", proj, p)));
    assertEquals(
        List.of("src/main/java/com/TheFile.java"),
        service.linkedSourcesOf("src/test/java/com/TheFileSpecialCaseTest.java", proj, p));
    assertEquals(
        List.of("src/main/java/com/TheFile.java"),
        service.linkedSourcesOf("src/test/java/com/TheFileRecordingIT.java", proj, p));
  }

  @Test
  void attributesAQualifiedTestToTheMostSpecificSourceWhenOneExists() {
    List<String> p =
        List.of(
            "pom.xml",
            "src/main/java/com/TheFile.java",
            "src/main/java/com/TheFileSpecialCase.java",
            "src/test/java/com/TheFileTest.java",
            "src/test/java/com/TheFileSpecialCaseTest.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(
        List.of("src/main/java/com/TheFileSpecialCase.java"),
        service.linkedSourcesOf("src/test/java/com/TheFileSpecialCaseTest.java", proj, p));
    assertEquals(
        List.of("src/test/java/com/TheFileSpecialCaseTest.java"),
        service.linkedTestsOf("src/main/java/com/TheFileSpecialCase.java", proj, p));
    // …so TheFile.java only owns TheFileTest, not the more-specific test
    assertEquals(
        List.of("src/test/java/com/TheFileTest.java"),
        service.linkedTestsOf("src/main/java/com/TheFile.java", proj, p));
  }

  // ---- permissive java test folding (the [A-Z]* extension) -----------------------------------

  private static final String SRC = "src/main/java/com";
  private static final String TST = "src/test/java/com";

  @Test
  void foldsAScenarioNamedTestIntoTheSingleSourceThatExtendsItsPrefix() {
    List<String> p =
        List.of(
            "pom.xml",
            SRC + "/OtelProxyResource.java",
            TST + "/OtelProxyResourceTest.java",
            TST + "/OtelProxyUnreachableTest.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(
        List.of(SRC + "/OtelProxyResource.java"),
        service.linkedSourcesOf(TST + "/OtelProxyUnreachableTest.java", proj, p));
    assertEquals(
        sorted(TST + "/OtelProxyResourceTest.java", TST + "/OtelProxyUnreachableTest.java"),
        sorted(service.linkedTestsOf(SRC + "/OtelProxyResource.java", proj, p)));
  }

  @Test
  void prefersAMoreSpecificExactSourceOverAnExtensionMatch() {
    List<String> p =
        List.of(
            "pom.xml",
            SRC + "/OtelProxyResource.java",
            SRC + "/OtelProxyUnreachable.java",
            TST + "/OtelProxyUnreachableTest.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(
        List.of(SRC + "/OtelProxyUnreachable.java"),
        service.linkedSourcesOf(TST + "/OtelProxyUnreachableTest.java", proj, p));
    assertEquals(List.of(), service.linkedTestsOf(SRC + "/OtelProxyResource.java", proj, p));
  }

  @Test
  void foldsIntoNeitherSourceWhenTheExtensionPrefixIsAmbiguous() {
    List<String> p =
        List.of(
            "pom.xml",
            SRC + "/OtelProxyResource.java",
            SRC + "/OtelProxyClient.java",
            TST + "/OtelProxyUnreachableTest.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(
        List.of(), service.linkedSourcesOf(TST + "/OtelProxyUnreachableTest.java", proj, p));
    assertEquals(List.of(), service.linkedTestsOf(SRC + "/OtelProxyResource.java", proj, p));
    assertEquals(List.of(), service.linkedTestsOf(SRC + "/OtelProxyClient.java", proj, p));
  }

  @Test
  void neverFuzzyFoldsATestSharingOnlyItsFirstCamelWord() {
    List<String> p = List.of("pom.xml", SRC + "/FooBaz.java", TST + "/FooBarTest.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(List.of(), service.linkedSourcesOf(TST + "/FooBarTest.java", proj, p));
    assertEquals(List.of(), service.linkedTestsOf(SRC + "/FooBaz.java", proj, p));
  }

  @Test
  void foldsAQuarkusTestLikeAnyTest() {
    List<String> p =
        List.of(
            "pom.xml", SRC + "/GreetingResource.java", TST + "/GreetingResourceQuarkusTest.java");
    List<DetectedProject> proj = service.detect(p);
    assertEquals(
        List.of(SRC + "/GreetingResource.java"),
        service.linkedSourcesOf(TST + "/GreetingResourceQuarkusTest.java", proj, p));
    assertEquals(
        List.of(TST + "/GreetingResourceQuarkusTest.java"),
        service.linkedTestsOf(SRC + "/GreetingResource.java", proj, p));
  }

  @Test
  void openingAnyGroupMemberYieldsTheIdenticalStrip() {
    List<String> p =
        List.of(
            "pom.xml",
            SRC + "/OtelProxyResource.java",
            TST + "/OtelProxyResourceTest.java",
            TST + "/OtelProxyUnreachableTest.java");
    List<DetectedProject> proj = service.detect(p);
    var fromSource = service.resolveLinkedGroup(SRC + "/OtelProxyResource.java", proj, p);
    var fromTest = service.resolveLinkedGroup(TST + "/OtelProxyUnreachableTest.java", proj, p);
    assertEquals(fromSource, fromTest);
    assertEquals(
        List.of(
            SRC + "/OtelProxyResource.java",
            TST + "/OtelProxyResourceTest.java",
            TST + "/OtelProxyUnreachableTest.java"),
        fromSource.stream().map(FrameworkDetectionService.LinkedFile::path).toList());
    assertEquals("code", fromSource.get(0).role());
  }

  @Test
  void resolveLinkedGroupReturnsEmptyForAnOrphanTestAndAnUntestedSource() {
    List<String> lonely = List.of("pom.xml", "src/main/java/com/Lonely.java");
    assertEquals(
        List.of(),
        service.resolveLinkedGroup(
            "src/main/java/com/Lonely.java", service.detect(lonely), lonely));
  }

  // ---- gitignore glob translator (spot checks of the ported matcher) -------------------------

  @Test
  void gitignoreGlobDistinguishesDoubleStarFromSingleStar() {
    assertTrue(
        FrameworkDetectionService.gitignoreGlobToRegExp("**/*.java", true)
            .matcher("a/b/C.java")
            .matches());
    assertTrue(
        FrameworkDetectionService.gitignoreGlobToRegExp("**/*.java", true)
            .matcher("C.java")
            .matches());
    assertTrue(
        FrameworkDetectionService.gitignoreGlobToRegExp("src/**", true)
            .matcher("src/a/b.ts")
            .matches());
    // single * stays within a segment
    assertTrue(
        !FrameworkDetectionService.gitignoreGlobToRegExp("tsconfig*.json", true)
            .matcher("tsconfig/app.json")
            .matches());
    assertTrue(
        FrameworkDetectionService.gitignoreGlobToRegExp("tsconfig*.json", true)
            .matcher("tsconfig.app.json")
            .matches());
  }

  private static List<String> sorted(String... values) {
    return sorted(List.of(values));
  }

  private static List<String> sorted(List<String> values) {
    List<String> copy = new ArrayList<>(values);
    copy.sort(java.util.Comparator.naturalOrder());
    return copy;
  }

  @Test
  void descriptorByIdResolvesShippedKindsAndNullOtherwise() {
    assertEquals("java-quarkus", FrameworkDetectionService.descriptorById("java-quarkus").id());
    assertEquals("ts-angular", FrameworkDetectionService.descriptorById("ts-angular").id());
    assertEquals("docs", FrameworkDetectionService.descriptorById("docs").id());
    assertNull(FrameworkDetectionService.descriptorById("rust-cargo"));
    assertNull(FrameworkDetectionService.descriptorById(null));
  }
}
