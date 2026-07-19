package eu.wohlben.qits.userflows.projectrepository;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.Urls;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import eu.wohlben.qits.userflows.UserflowTarget;
import eu.wohlben.qits.userflows.project.CreateProjectIT;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * Adds a repository to the (empty) project {@link CreateProjectIT} created, cloning from a local
 * fixture bare — a host-side clone, so no docker is needed. Because the host project starts with no
 * repositories, the one added here is the only card, making its id easy to capture for {@link
 * DeleteRepositoryIT}. Skipped if create-project didn't pass; the project's later deletion
 * cascade-cleans the repository if this chain is interrupted.
 */
@Tag("extended")
class CreateRepositoryIT {

  static final String REPO_ID_KEY = "repository.id";

  /**
   * A local fixture bare qits can clone host-side. Overridable for other environments; the default
   * resolves the tiny submodule-free `testing-repo` fixture in the sibling domain module.
   */
  static final String CLONE_URL =
      System.getProperty(
          "qits.userflows.repo-clone-url",
          Path.of("..", "domain", "target", "test-classes", "fixtures", "testing-repo.git")
              .toAbsolutePath()
              .normalize()
              .toString());

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Create a repository")
  @UserStoryDescription(
      """
      An operator adds a repository (cloned from a fixture) to the project the precondition
      created, then opens the new repository.
      """)
  @UserflowPrecondition(CreateProjectIT.class)
  void createRepository(Flow flow, UserflowContext context) {
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);

    flow.navigate("/projects/{}/repositories/new", projectId);
    flow.waitFor("input#repository-url");
    flow.fill("input#repository-url", CLONE_URL);
    flow.click("button[type=submit]");
    // Save returns to the project detail; the project had no repositories, so this is the only card
    flow.waitFor("app-repository-card");
    flow.click("a:has-text('View')");
    flow.waitFor("app-repository-detail-page");
    flow.screenshot("app-repository-detail-page", "created repository").as("created");

    context.put(REPO_ID_KEY, Urls.lastPathSegment(flow.currentUrl()));
  }
}
