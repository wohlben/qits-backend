package eu.wohlben.qits.userflows.project;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import eu.wohlben.qits.userflows.UserflowRunsAfter;
import eu.wohlben.qits.userflows.UserflowTarget;
import eu.wohlben.qits.userflows.projectrepository.DeleteRepositoryIT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * The cleanup tail of the whole chain. Its gate is <b>create</b> (a project must exist to delete),
 * but it only <b>runs after</b> the edit and the repository stories — <i>regardless</i> of whether
 * they passed — so a failure mid-chain still gets cleaned up rather than stranding the project. It
 * deletes by the id create stashed (cascade-removing any repository) and confirms the card is gone.
 */
@Tag("extended")
class DeleteProjectIT {

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Delete the project")
  @UserStoryDescription(
      "An operator deletes the project the earlier flows created (and maybe edited).")
  @UserflowPrecondition(CreateProjectIT.class)
  @UserflowRunsAfter({EditProjectIT.class, DeleteRepositoryIT.class})
  void deleteProject(Flow flow, UserflowContext context) {
    String id = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);
    // the project's current name — create set it, edit overwrote it only if it succeeded
    String currentName = context.getString(CreateProjectIT.PROJECT_NAME_KEY);

    // the Delete button pops a native confirm() — accept it
    flow.page().onDialog(dialog -> dialog.accept());

    flow.navigate("/projects/{}", id);
    flow.waitFor("app-project-detail-page");
    flow.click("button:has-text('Delete')");
    // delete lands back on the projects list (which the mutation invalidates) — the card is gone
    flow.waitFor("app-project-list");
    flow.expectAbsent("a:has(h3:has-text('" + currentName + "'))");
    flow.screenshot("app-project-list", "projects after delete").as("deleted");
  }
}
