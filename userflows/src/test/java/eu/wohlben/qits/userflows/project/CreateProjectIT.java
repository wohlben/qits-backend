package eu.wohlben.qits.userflows.project;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.Urls;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowTarget;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;

/**
 * The <b>producer</b> of the project-lifecycle chain (the reference dependent-userflow example): it
 * creates a project through qits' admin UI, opens it, and stashes the new project's id + name into
 * the shared {@link UserflowContext} for {@link EditProjectIT} and {@link DeleteProjectIT} to build
 * on. Extended + self-skipping like every app story.
 */
@Tag("extended")
public class CreateProjectIT {

  /** Fixed demo name (not per-run) so the locate-by-name selectors stay hash-stable. */
  static final String DEMO_NAME = "Userflow lifecycle demo";

  /** Public: dependent stories in other domain packages (e.g. projectrepository) read the id. */
  public static final String PROJECT_ID_KEY = "project.id";

  static final String PROJECT_NAME_KEY = "project.name";

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Create a project")
  @UserStoryDescription(
      """
      An operator opens the new-project form, names a project, creates it, and opens it —
      establishing the project the edit and delete flows depend on.
      """)
  void createProject(Flow flow, UserflowContext context) {
    flow.navigate("/projects/new");
    flow.waitFor("input#project-name");
    flow.fill("input#project-name", DEMO_NAME);
    flow.click("button[type=submit]");
    // create lands on the projects list; open the new project's card to reach its detail (and id)
    flow.waitFor("a:has(h3:has-text('" + DEMO_NAME + "'))");
    flow.click("a:has(h3:has-text('" + DEMO_NAME + "'))");
    flow.waitFor("app-project-detail-page h1");
    flow.screenshot("app-project-detail-page", "created project").as("created");

    context.put(PROJECT_ID_KEY, Urls.lastPathSegment(flow.currentUrl()));
    context.put(PROJECT_NAME_KEY, DEMO_NAME);
  }
}
