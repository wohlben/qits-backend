package eu.wohlben.qits.userflows.epic;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import eu.wohlben.qits.userflows.UserflowRunsAfter;
import eu.wohlben.qits.userflows.UserflowTarget;
import eu.wohlben.qits.userflows.project.CreateProjectIT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * Inspects the epic's audit history, then deletes the epic {@link CreateEpicIT} created (its
 * features and tasks cascade in-service) and confirms it's gone from the project. Cleanup edge:
 * runs after the mark-implemented story regardless of its outcome, but is skipped if create-epic
 * didn't pass. Public so {@code DeleteRepositoryIT} can order itself after the whole epic chain.
 */
@Tag("extended")
public class DeleteEpicIT {

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Delete the epic")
  @UserStoryDescription(
      """
      An operator opens the epic's audit history, then deletes the epic from its detail page —
      features and tasks go with it — and sees the project's Epics section empty again.
      """)
  @UserflowPrecondition(CreateEpicIT.class)
  @UserflowRunsAfter(MarkTaskImplementedIT.class)
  void deleteEpic(Flow flow, UserflowContext context) {
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);
    String epicId = context.require(CreateEpicIT.EPIC_ID_KEY, String.class);

    // the Delete button pops a native confirm() — accept it
    flow.page().onDialog(dialog -> dialog.accept());

    flow.navigate("/projects/{}/epics/{}", projectId, epicId);
    flow.waitFor("app-epic-detail-page h1");
    // the collapsed History section holds the whole subtree's audit trail
    flow.click("summary:has-text('History')");
    flow.waitFor("app-audit-entry-row");
    flow.screenshot("app-epic-audit-list", "audit history before deletion").as("audit");

    flow.click("button:has-text('Delete')");
    // delete returns to the project detail; the epics section is empty again
    flow.waitFor("app-project-detail-page");
    flow.expectAbsent("app-epic-card");
    flow.screenshot("app-project-detail-page", "project without epics").as("deleted");
  }
}
