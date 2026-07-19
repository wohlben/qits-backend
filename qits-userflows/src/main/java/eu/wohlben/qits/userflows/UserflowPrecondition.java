package eu.wohlben.qits.userflows;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares that a {@link UserStory} <b>depends on</b> other stories: they must run first and pass,
 * or this story is skipped. Userflows are e2e tests against one shared running qits, so a dependent
 * story builds on the server-side state a precondition produced (and reads any handed-off values
 * via an injected {@link UserflowContext}) rather than creating its own from scratch.
 *
 * <p>Each value is a story <b>class</b> — one {@code @UserStory} per class (the module convention).
 * The framework:
 *
 * <ul>
 *   <li><b>orders</b> every precondition class before its dependents ({@code
 *       UserflowClassOrderer}),
 *   <li><b>skips</b> this story — before a browser even launches — if any precondition did not pass
 *       (a failed, {@code @ExpectedFailure}, or itself-skipped precondition does not satisfy),
 *   <li>skips transitively: a dependent of a skipped story is skipped too.
 * </ul>
 *
 * <p>Goes on the {@code @UserStory} method (all story annotations stay method-level):
 *
 * <pre>{@code
 * @UserStory("Edit the project")
 * @UserflowPrecondition(CreateProjectIT.class)
 * void editProject(Flow flow, UserflowContext context) {
 *   String id = context.require("project.id", String.class);
 *   flow.navigate("/projects/" + id + "/edit");
 *   …
 * }
 * }</pre>
 *
 * <p>Note: running a dependent story <i>alone</i> (e.g. {@code -Dtest=EditProjectIT}) skips it,
 * because its precondition never ran — the intended "precondition absent → skip" behavior.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface UserflowPrecondition {

  /** The story classes this story depends on; each must have run and passed first. */
  Class<?>[] value();
}
