package eu.wohlben.qits.userflows.harness;

import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowRunsAfter;
import org.junit.jupiter.api.AfterAll;

/**
 * Proves {@link UserflowRunsAfter} is ordering-only, not a gate: it runs after {@link
 * SkipChainFailingProducerHarnessTest} (whose story fails) and — unlike a precondition — is <b>not
 * skipped</b> by that failure. The {@code @AfterAll} companion asserts the body ran (contrast with
 * {@link SkipChainSkippedConsumerHarnessTest}, which a failed <i>precondition</i> skips).
 */
class RunsAfterFailureHarnessTest {

  private static boolean ran;

  @UserStory("Runs after failure")
  @UserStoryDescription(
      "Runs after a failing story because runs-after is ordering-only, not gating.")
  @UserflowRunsAfter(SkipChainFailingProducerHarnessTest.class)
  void runsAnyway(Flow flow) {
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
    flow.waitFor("input[name=name]");
    flow.screenshot("body", "ran after failure");
    ran = true;
  }

  @AfterAll
  static void ranDespiteFailedPredecessor() {
    assertTrue(
        ran, "runs-after story was skipped — an ordering-only edge must not gate on outcome");
  }
}
