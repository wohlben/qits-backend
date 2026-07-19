package eu.wohlben.qits.userflows;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The prose describing a {@link UserStory}: multiline <b>markdown</b>, rendered verbatim into the
 * report's "User flow" section and stored as the {@code description} field of {@code
 * userflow.json}.
 *
 * <p>Optional — a story without one still reports; the description section is simply omitted.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface UserStoryDescription {

  /** Markdown prose, typically a text block; rendered verbatim into the report. */
  String value();
}
