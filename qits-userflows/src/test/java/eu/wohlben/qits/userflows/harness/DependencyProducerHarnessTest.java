package eu.wohlben.qits.userflows.harness;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;

/**
 * Harness producer for the dependency demo (no app): it stashes a value into the shared {@link
 * UserflowContext} that {@link DependencyConsumerHarnessTest} then reads. Named so it sorts
 * <i>after</i> the consumer alphabetically — the consumer only passes if the class orderer runs
 * this producer first, which is the point of the test.
 */
class DependencyProducerHarnessTest {

  /** Namespaced context key handed off to the dependent story. */
  static final String TOKEN_KEY = "harness.dependency.token";

  @UserStory("Dependency producer")
  @UserStoryDescription(
      "Produces a value into the shared context for a dependent story to consume.")
  void produce(Flow flow, UserflowContext context) {
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
    flow.waitFor("input[name=name]");
    flow.screenshot("body", "producer page");
    context.put(TOKEN_KEY, "produced-ok");
  }
}
