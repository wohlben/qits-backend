package eu.wohlben.qits.userflows.epic;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.Urls;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import eu.wohlben.qits.userflows.UserflowTarget;
import eu.wohlben.qits.userflows.project.CreateProjectIT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * The <b>producer</b> of the planning-domain chain: it creates an epic (with a markdown spine)
 * under the project {@link CreateProjectIT} created, opens it, and stashes the epic's id for the
 * feature/task stories to build on. Skipped if create-project didn't pass.
 */
@Tag("extended")
public class CreateEpicIT {

  /** Fixed demo title (not per-run) so the locate-by-title selectors stay hash-stable. */
  static final String DEMO_TITLE = "Userflow planning demo";

  public static final String EPIC_ID_KEY = "epic.id";

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Create an epic")
  @UserStoryDescription(
      """
      An operator opens the new-epic form from the project detail, titles the epic and writes its
      markdown spine, creates it, and opens it — establishing the epic the feature and task flows
      depend on.
      """)
  @UserflowPrecondition(CreateProjectIT.class)
  void createEpic(Flow flow, UserflowContext context) {
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);

    flow.navigate("/projects/{}/epics/new", projectId);
    flow.waitFor("input#epic-title");
    flow.fill("input#epic-title", DEMO_TITLE);
    flow.fill(
        "textarea#epic-description",
        "# The planning spine\n\nEpics own **features**, features own tasks.");
    flow.click("button[type=submit]");
    // create lands on the project detail; the project has exactly one epic card — open it
    flow.waitFor("app-epic-card");
    flow.click("app-epic-card a:has-text('View')");
    flow.waitFor("app-epic-detail-page h1");
    flow.screenshot("app-epic-detail-page", "created epic with rendered markdown spine")
        .as("created");

    context.put(EPIC_ID_KEY, Urls.lastPathSegment(flow.currentUrl()));
  }
}
