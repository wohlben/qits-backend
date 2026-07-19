package eu.wohlben.qits.userflows;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * Marks a method as a <b>user story</b>: a named, step-recorded walk through the UI that renders
 * itself into a report under {@code target/userstories/<slug>/}.
 *
 * <p>This is a meta-annotation for {@link Test @Test} plus {@link UserStoryExtension} — so an
 * author writes a single {@code @UserStory("…")} method that takes a {@link Flow} parameter and
 * nothing else; the extension sets up the browser + video, injects the recording {@link Flow}, and
 * emits the report (see {@link UserStoryExtension}).
 *
 * <p>The {@link #value()} is the story's display name: it is slugged into the report directory name
 * and is the future {@code qits.userflow.name} artifacts-metadata key.
 *
 * <pre>{@code
 * @UserStory("Create a greeting")
 * @UserStoryDescription("""
 *     A visitor opens the greeting page, submits their name, and sees the
 *     greeting echoed back — the core loop of the demo app.
 *     """)
 * void createGreeting(Flow flow) {
 *   flow.navigate("/");
 *   flow.fill("input[name=name]", "Ada");
 *   flow.click("button[type=submit]");
 *   flow.screenshot(".greeting-result", "greeting result");
 * }
 * }</pre>
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@Test
@ExtendWith(UserStoryExtension.class)
public @interface UserStory {

  /** The story's display name — also the (slugged) report directory name. */
  String value();
}
