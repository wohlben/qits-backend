package eu.wohlben.qits.userflows.projectrepository;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import eu.wohlben.qits.userflows.UserflowTarget;
import eu.wohlben.qits.userflows.project.CreateProjectIT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * Deletes the repository {@link CreateRepositoryIT} added, from its detail page, and confirms it's
 * gone from the project. Skipped if create-repository didn't pass.
 */
@Tag("extended")
public class DeleteRepositoryIT {

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Delete the repository")
  @UserStoryDescription(
      "An operator deletes the repository the precondition added, from its detail page.")
  @UserflowPrecondition(CreateRepositoryIT.class)
  void deleteRepository(Flow flow, UserflowContext context) {
    String repoId = context.require(CreateRepositoryIT.REPO_ID_KEY, String.class);
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);

    // the Delete button pops a native confirm() — accept it
    flow.page().onDialog(dialog -> dialog.accept());

    flow.navigate("/repositories/{}", repoId);
    flow.waitFor("app-repository-detail-page");
    flow.click("button:has-text('Delete')");
    flow.waitFor("app-project-list"); // delete returns to the projects list

    // the project's repository is gone
    flow.navigate("/projects/{}", projectId);
    flow.waitFor("app-project-detail-page");
    flow.expectAbsent("app-repository-card");
    flow.screenshot("app-project-detail-page", "project without repository").as("deleted");
  }
}
