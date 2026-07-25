package eu.wohlben.qits.userflows.epic;

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
 * Marks the task {@link CreateTaskIT} created as implemented from its detail page and sees the
 * badge appear. Skipped if create-task didn't pass.
 */
@Tag("extended")
public class MarkTaskImplementedIT {

  @BeforeAll
  static void requireRunningQits() {
    assumeTrue(
        UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Mark the task implemented")
  @UserStoryDescription(
      "An operator marks the task the precondition created as implemented; the badge appears.")
  @UserflowPrecondition(CreateTaskIT.class)
  void markTaskImplemented(Flow flow, UserflowContext context) {
    String projectId = context.require(CreateProjectIT.PROJECT_ID_KEY, String.class);
    String epicId = context.require(CreateEpicIT.EPIC_ID_KEY, String.class);
    String featureId = context.require(CreateFeatureIT.FEATURE_ID_KEY, String.class);
    String taskId = context.require(CreateTaskIT.TASK_ID_KEY, String.class);

    flow.navigate(
        "/projects/{}/epics/{}/features/{}/tasks/{}", projectId, epicId, featureId, taskId);
    flow.waitFor("app-task-detail-page h1");
    flow.click("button:has-text('Mark implemented')");
    flow.waitFor("z-badge:has-text('Implemented')");
    flow.screenshot("app-task-detail-page", "task with the implemented badge").as("implemented");
  }
}
