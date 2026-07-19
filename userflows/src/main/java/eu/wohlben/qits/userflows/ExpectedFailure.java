package eu.wohlben.qits.userflows;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a {@link UserStory} as <b>expected to fail</b>: the extension still emits the report
 * (partial step log, an appended failure step, {@code outcome: "failed"} in the sidecar), then
 * <i>swallows</i> the failure so the suite stays green — and instead fails the run if the story
 * unexpectedly <i>passed</i>.
 *
 * <p>Its only purpose is to give the framework's failure path honest coverage while keeping the
 * src/test rule absolute (the coverage itself takes story form). Real stories never carry it.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ExpectedFailure {}
