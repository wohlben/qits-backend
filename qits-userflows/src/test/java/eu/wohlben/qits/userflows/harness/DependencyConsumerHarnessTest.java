package eu.wohlben.qits.userflows.harness;

import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.userflows.Flow;
import eu.wohlben.qits.userflows.HarnessResources;
import eu.wohlben.qits.userflows.UserStory;
import eu.wohlben.qits.userflows.UserStoryDescription;
import eu.wohlben.qits.userflows.UserflowContext;
import eu.wohlben.qits.userflows.UserflowPrecondition;
import org.junit.jupiter.api.AfterAll;

/**
 * Harness dependent (no app): depends on {@link DependencyProducerHarnessTest} and reads the value
 * it produced. This proves two things at once — the class orderer ran the producer first (else the
 * execution condition would have <i>skipped</i> this story, since its precondition hadn't passed),
 * and the shared {@link UserflowContext} carried the value across. The {@code @AfterAll} companion
 * asserts the body actually ran (a skipped dependent would leave the flag false).
 */
class DependencyConsumerHarnessTest {

  private static boolean ran;

  @UserStory("Dependency consumer")
  @UserStoryDescription("Consumes a value a precondition produced, proving ordering + handoff.")
  @UserflowPrecondition(DependencyProducerHarnessTest.class)
  void consume(Flow flow, UserflowContext context) {
    String token = context.require(DependencyProducerHarnessTest.TOKEN_KEY, String.class);
    flow.navigate(HarnessResources.classpathUrl("/harness/greeting.html"));
    flow.waitFor("input[name=name]");
    flow.fill("input[name=name]", token);
    flow.screenshot("body", "consumer page");
    ran = true;
  }

  @AfterAll
  static void dependentRan() {
    assertTrue(ran, "dependent story did not run — was its precondition ordered/passed first?");
  }
}
