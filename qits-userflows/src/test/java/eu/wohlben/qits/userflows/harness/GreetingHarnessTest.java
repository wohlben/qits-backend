package eu.wohlben.qits.userflows.harness;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.report.ReportAssertions;
import eu.wohlben.qits.userflows.report.UserflowReport;
import java.util.List;
import org.junit.jupiter.api.AfterAll;

/**
 * The harness smoke story: it needs no running app (it drives a bundled static page), so it runs on
 * every default {@code ./mvnw -pl userflows test} and gives the framework itself — step recording,
 * screenshot capture, video, report + sidecar emission — end-to-end coverage. The {@code @AfterAll}
 * companion asserts the produced report is complete (all assertion plumbing lives in {@code
 * src/main}'s {@link ReportAssertions}, keeping this class a story only).
 */
class GreetingHarnessTest {

  @UserStory("Create a greeting")
  @UserStoryDescription(
      """
      A visitor opens the greeting page, submits their name, and sees the
      greeting echoed back with a timestamp — the core loop of the demo app.
      """)
  void createGreeting(Flow flow) {
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
    flow.waitFor("input[name=name]");
    flow.fill("input[name=name]", "Ada");
    flow.click("button[type=submit]");
    flow.waitFor(".greeting-result");
    flow.screenshot(".greeting-result", "greeting result").as("greeting-shown");
  }

  @AfterAll
  static void reportIsComplete() {
    // assertComplete also proves the screenshot's link followed the .as() rename: it resolves the
    // screenshot's step id against the steps and fails if that id no longer names a step.
    ReportAssertions.assertComplete("create-a-greeting", UserflowReport.PASSED);
    ReportAssertions.assertStepId("create-a-greeting", "greeting-shown");
    ReportAssertions.assertMarkdownContains(
        "create-a-greeting",
        List.of(
            "# Create a greeting",
            "core loop of the demo app",
            "fill input[name=name] \"Ada\"",
            "![greeting result](greeting-shown-greeting-result.png)"));
  }
}
