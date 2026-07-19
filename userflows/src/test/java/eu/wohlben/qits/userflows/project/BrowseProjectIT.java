package eu.wohlben.qits.userflows.project;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowTarget;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * A project-level browse: opens the projects list and the seeded "Quarkus + Angular Demo" project's
 * detail (name + its repositories) — stopping at the project, without drilling into a repository
 * (that's {@code projectrepository}'s territory). Read-only, so it stands alone (no dependency).
 */
@Tag("extended")
class BrowseProjectIT {

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Browse a project")
  @UserStoryDescription(
      """
      An operator opens the projects list and the seeded "Quarkus + Angular Demo" project to
      see its details and repositories.
      """)
  void browseProject(Flow flow) {
    flow.navigate("/projects");
    flow.waitFor("app-project-card");
    flow.screenshot("app-project-list", "projects list").as("projects-list");
    flow.click("a:has-text('Quarkus + Angular Demo')");
    flow.waitFor("h2:has-text('Repositories')");
    flow.screenshot("app-project-detail-page", "project detail").as("project-detail");
  }
}
