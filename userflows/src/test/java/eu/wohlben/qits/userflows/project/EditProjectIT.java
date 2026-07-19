package eu.wohlben.qits.userflows.project;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import eu.wohlben.qits.userflows.UserflowTarget;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * Depends on {@link CreateProjectIT}: reads the created project's id from the shared context, edits
 * it through the edit form — changing its name — and verifies the new name on the detail page.
 * Skipped if create didn't pass. Navigates by templated id so the definition hash stays stable per
 * run.
 */
@Tag("extended")
class EditProjectIT {

  static final String NEW_NAME = CreateProjectIT.DEMO_NAME + " (edited)";

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Edit the project")
  @UserStoryDescription(
      "An operator opens the project the precondition created in the edit form and changes its name.")
  @UserflowPrecondition(CreateProjectIT.class)
  void editProject(Flow flow, UserflowContext context) {
    String id = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);

    flow.navigate("/projects/{}/edit", id);
    flow.waitFor("input#project-name");
    flow.fill("input#project-name", NEW_NAME);
    flow.click("button[type=submit]");
    flow.waitFor("app-project-detail-page h1");
    flow.expectText("app-project-detail-page h1", NEW_NAME);
    flow.screenshot("app-project-detail-page", "edited project").as("edited");

    context.put(CreateProjectIT.PROJECT_NAME_KEY, NEW_NAME);
  }
}
