package eu.wohlben.qits.userflows.harness;

import static org.junit.jupiter.api.Assertions.assertFalse;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import org.junit.jupiter.api.AfterAll;

/**
 * Harness dependent whose precondition ({@link SkipChainFailingProducerHarnessTest}) fails — so the
 * execution condition must skip this story before it launches a browser. The {@code @AfterAll}
 * companion asserts the body never ran (still runs even though the single test method was skipped,
 * because the class container itself is never disabled).
 */
class SkipChainSkippedConsumerHarnessTest {

  private static boolean ran;

  @UserStory("Skip-chain consumer")
  @UserStoryDescription("Should be skipped because its precondition failed.")
  @UserflowPrecondition(SkipChainFailingProducerHarnessTest.class)
  void shouldBeSkipped(Flow flow) {
    ran = true; // must never execute
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
  }

  @AfterAll
  static void dependentWasSkipped() {
    assertFalse(
        ran, "dependent story ran even though its precondition failed — skip did not apply");
  }
}
