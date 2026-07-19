package eu.wohlben.qits.userflows.harness;

import eu.wohlben.qits.userflows.ExpectedFailure;
import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;

/**
 * Harness producer that deliberately fails ({@link ExpectedFailure} keeps the suite green while its
 * outcome is FAILED) — so it never satisfies a precondition. {@link
 * SkipChainSkippedConsumerHarnessTest} depends on it and must therefore be skipped, proving the
 * skip-on-failed-precondition path.
 */
class SkipChainFailingProducerHarnessTest {

  @UserStory("Skip-chain producer")
  @UserStoryDescription("Fails on purpose so a dependent story is skipped, not run.")
  @ExpectedFailure
  void failOnPurpose(Flow flow) {
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
    flow.waitFor(".never-appears", 500); // times out → this story fails
  }
}
