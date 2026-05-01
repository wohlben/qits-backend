package eu.wohlben.qits.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * Validates that a {@link String} is not blank <strong>if</strong> it is non-null.
 * Null values are considered valid, making this constraint useful for partial-update DTOs.
 */
@Documented
@Constraint(validatedBy = NotBlankIfPresentValidator.class)
@Target({ FIELD, PARAMETER })
@Retention(RUNTIME)
public @interface NotBlankIfPresent {

    String message() default "must not be blank";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
