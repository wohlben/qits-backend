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
 * Adds a feature to the epic {@link CreateEpicIT} created and opens its detail page. Because the
 * epic starts featureless, the one added here is the only card, making its id easy to capture for
 * {@link CreateTaskIT}. Skipped if create-epic didn't pass.
 */
@Tag("extended")
public class CreateFeatureIT {

  static final String DEMO_TITLE = "Segmented drill-down";

  public static final String FEATURE_ID_KEY = "feature.id";

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Create a feature")
  @UserStoryDescription(
      """
      An operator opens the new-feature form from the epic detail, titles the feature, creates it,
      and opens it — the drill-down's middle level.
      """)
  @UserflowPrecondition(CreateEpicIT.class)
  void createFeature(Flow flow, UserflowContext context) {
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);
    String epicId = context.require(CreateEpicIT.EPIC_ID_KEY, String.class);

    flow.navigate("/projects/{}/epics/{}/features/new", projectId, epicId);
    flow.waitFor("input#feature-title");
    flow.fill("input#feature-title", DEMO_TITLE);
    flow.click("button[type=submit]");
    // create lands on the epic detail; the epic has exactly one feature card — open it
    flow.waitFor("app-feature-card");
    flow.click("app-feature-card a:has-text('View')");
    flow.waitFor("app-feature-detail-page h1");
    flow.screenshot("app-feature-detail-page", "created feature").as("created");

    context.put(FEATURE_ID_KEY, Urls.lastPathSegment(flow.currentUrl()));
  }
}
