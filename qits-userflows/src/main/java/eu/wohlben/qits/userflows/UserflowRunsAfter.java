package eu.wohlben.qits.userflows;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares an <b>ordering-only</b> dependency: this story runs <i>after</i> the referenced stories,
 * but — unlike {@link UserflowPrecondition} — their outcome is not a gate. The story runs whether
 * the referenced stories passed, failed, or were skipped.
 *
 * <p>The use case is <b>cleanup</b> (and other "do this last" ordering): a delete flow should run
 * after the flows that mutate a thing, <i>regardless</i> of whether those succeeded, so a failure
 * mid-chain doesn't strand state. Pair it with a {@link UserflowPrecondition} for the state it
 * actually needs:
 *
 * <pre>{@code
 * @UserStory("Delete the project")
 * @UserflowPrecondition(CreateProjectIT.class)   // needs the project — skip if create failed
 * @UserflowRunsAfter(EditProjectIT.class)      // run after edit, pass or fail
 * void deleteProject(Flow flow, UserflowContext context) { … }
 * }</pre>
 *
 * <p>Each value is a story <b>class</b> (one {@code @UserStory} per class). A referenced class not
 * in the current run is a no-op ordering hint. Purely ordering — it never causes a skip.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface UserflowRunsAfter {

  /** The story classes this story must be ordered after (outcome ignored). */
  Class<?>[] value();
}
