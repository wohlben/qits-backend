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
import eu.wohlben.qits.userflows.projectrepository.CreateRepositoryIT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * Adds a task to the feature {@link CreateFeatureIT} created, binding it to the repository {@link
 * CreateRepositoryIT} added (picked in the repository select by its clone-URL text — the project's
 * only repository), then opens the task detail showing the repository link. Skipped if either
 * precondition didn't pass.
 */
@Tag("extended")
public class CreateTaskIT {

  static final String DEMO_TITLE = "Wire the endpoint";

  public static final String TASK_ID_KEY = "task.id";

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Create a task bound to a repository")
  @UserStoryDescription(
      """
      An operator opens the new-task form from the feature detail, titles the task, binds it to
      the project's repository via the picker, creates it, and opens it — the drill-down's leaf,
      where planning meets a concrete repository.
      """)
  @UserflowPrecondition({CreateFeatureIT.class, CreateRepositoryIT.class})
  void createTask(Flow flow, UserflowContext context) {
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);
    String epicId = context.require(CreateEpicIT.EPIC_ID_KEY, String.class);
    String featureId = context.require(CreateFeatureIT.FEATURE_ID_KEY, String.class);

    flow.navigate("/projects/{}/epics/{}/features/{}/tasks/new", projectId, epicId, featureId);
    flow.waitFor("input#task-title");
    flow.fill("input#task-title", DEMO_TITLE);
    // the repository picker is a z-select popover: open it, pick the only repository by URL text
    flow.click("z-select#task-repository");
    flow.click("z-select-item:has-text('testing-repo.git')");
    flow.click("button[type=submit]");
    // create lands on the feature detail; the feature has exactly one task card — open it
    flow.waitFor("app-task-card");
    flow.click("app-task-card a:has-text('View')");
    flow.waitFor("app-task-detail-page h1");
    flow.expectText("app-task-detail-header", "Repository");
    flow.screenshot("app-task-detail-page", "created task with its repository binding")
        .as("created");

    context.put(TASK_ID_KEY, Urls.lastPathSegment(flow.currentUrl()));
  }
}
