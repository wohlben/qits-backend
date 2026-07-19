package eu.wohlben.qits.userflows.projectrepository;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowTarget;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * The reference story against a running qits (the {@code seed-webapp} known-good state): the
 * operator opens the projects list, picks the seeded "Quarkus + Angular Demo" project, and drills
 * into its repository to see the branch tree. As an {@code *IT} it runs only under {@code
 * -Pextended}, and it {@code assumeTrue}-skips when nothing answers on the base URL — so it's safe
 * in every default build and on any machine without qits running (mirrors {@code
 * WorkspaceContainerIT}).
 *
 * <p>Run it with qits up and seeded:
 *
 * <pre>{@code
 * ./mvnw install -DskipTests
 * ./mvnw -pl service -am quarkus:dev            # serves the UI on :8080
 * ./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp
 * ./mvnw -pl userflows verify -Pextended -Dqits.dev-guard.skip=true
 * }</pre>
 */
@Tag("extended")
class BrowseDemoProjectIT {

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () ->
            "qits not reachable at "
                + UserflowTarget.baseUrl()
                + " — start it and run `cli seed-webapp` first (skipping)");
  }

  @UserStory("Browse the demo project")
  @UserStoryDescription(
      """
      An operator opens the projects list, picks the seeded "Quarkus + Angular Demo"
      project, and drills into its repository to see the branch tree — proof that the
      base-url and seed-webapp conventions hold end-to-end.
      """)
  void browseDemoProject(Flow flow) {
    flow.navigate("/projects");
    flow.waitFor("app-project-card");
    flow.screenshot("app-project-list", "projects list").as("projects-list");
    flow.click("a:has-text('Quarkus + Angular Demo')");
    flow.waitFor("h2:has-text('Repositories')");
    flow.click("a:has-text('View')");
    flow.waitFor("h2:has-text('Branches')");
    flow.screenshot("app-branch-list", "branch tree").as("branch-tree");
  }
}
