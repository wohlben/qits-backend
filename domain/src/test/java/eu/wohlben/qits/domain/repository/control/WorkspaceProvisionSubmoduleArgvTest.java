package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.RepositorySubmodule;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Pins the container-side git commands {@link WorkspaceService#submoduleWiringCommands} emits for
 * ONE level of the submodule walk. The critical guarantee is that with <em>no</em> submodule edges
 * it emits <em>nothing</em> — so the clone stays byte-for-byte the historical argv and every one of
 * the ~45 submodule-free workspace tests is a strict no-op by construction. With edges it points
 * each submodule at its child's git-host url and then runs one non-recursive {@code submodule
 * update --init}, all rooted at the level's path — nested levels get the same sequence re-emitted
 * at their own path by {@code wireSubmodules} (never git's own {@code --recursive}, whose nested
 * url derivation cannot be overridden ahead of time).
 */
class WorkspaceProvisionSubmoduleArgvTest {

  /** Stands in for {@code cloneUrl(childId)} — the child's git-host url. */
  private String childUrl(Repository child) {
    return "http://qits:8080/git/" + child.id;
  }

  private RepositorySubmodule edge(String name, String childId) {
    RepositorySubmodule s = new RepositorySubmodule();
    s.name = name;
    s.child = new Repository();
    s.child.id = childId;
    s.path = name;
    return s;
  }

  @Test
  void noSubmodulesEmitsNoCommands() {
    assertTrue(
        WorkspaceService.submoduleWiringCommands(List.of(), ".", this::childUrl).isEmpty(),
        "a submodule-free workspace runs nothing beyond the historical clone");
  }

  @Test
  void oneSubmoduleOverridesItsUrlThenUpdates() {
    assertEquals(
        List.of(
            List.of(
                "-C",
                ".",
                "config",
                "submodule.src/main/webui.url",
                "http://qits:8080/git/child-42"),
            List.of("-C", ".", "submodule", "update", "--init", "--", "src/main/webui")),
        WorkspaceService.submoduleWiringCommands(
            List.of(edge("src/main/webui", "child-42")), ".", this::childUrl));
  }

  @Test
  void multipleSubmodulesEachGetTheirOwnOverrideBeforeASingleUpdate() {
    assertEquals(
        List.of(
            List.of("-C", ".", "config", "submodule.child-a.url", "http://qits:8080/git/id-a"),
            List.of("-C", ".", "config", "submodule.shared.url", "http://qits:8080/git/id-shared"),
            List.of("-C", ".", "submodule", "update", "--init", "--", "child-a", "shared")),
        WorkspaceService.submoduleWiringCommands(
            List.of(edge("child-a", "id-a"), edge("shared", "id-shared")), ".", this::childUrl));
  }

  @Test
  void nestedLevelRootsEveryCommandAtTheChildPath() {
    assertEquals(
        List.of(
            List.of(
                "-C",
                "fixtures/quarkus-angular",
                "config",
                "submodule.src/main/webui.url",
                "http://qits:8080/git/angular-lib"),
            List.of(
                "-C",
                "fixtures/quarkus-angular",
                "submodule",
                "update",
                "--init",
                "--",
                "src/main/webui")),
        WorkspaceService.submoduleWiringCommands(
            List.of(edge("src/main/webui", "angular-lib")),
            "fixtures/quarkus-angular",
            this::childUrl));
  }
}
