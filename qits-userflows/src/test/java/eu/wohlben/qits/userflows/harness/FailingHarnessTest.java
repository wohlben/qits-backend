package eu.wohlben.qits.userflows.harness;

import eu.wohlben.qits.userflows.ExpectedFailure;
import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.report.ReportAssertions;
import org.junit.jupiter.api.AfterAll;

/**
 * The expected-failure harness story: it deliberately waits for a selector that never appears, so
 * it fails mid-run — proving the framework's failure path (partial step log, an appended {@code
 * FAILED:} line, {@code outcome: "failed"} in the sidecar). {@link ExpectedFailure} makes the
 * extension swallow the failure so the suite stays green; the {@code @AfterAll} companion then
 * asserts the failure was reported honestly.
 */
class FailingHarnessTest {

  @UserStory("Failing harness")
  @UserStoryDescription("A story that fails on purpose, to exercise the failure-reporting path.")
  @ExpectedFailure
  void failsOnMissingSelector(Flow flow) {
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
    flow.waitFor("input[name=name]");
    flow.waitFor(".never-appears", 500); // times out → the story fails here
  }

  @AfterAll
  static void failurePathReported() {
    ReportAssertions.assertFailedWithPartialLog("failing-harness");
  }
}
