package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.error.BadRequestException;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Shared field validation for daemon definitions of both scopes. Regexes are compiled at definition
 * time so a broken pattern fails the request, not the supervisor's reader thread.
 */
final class DaemonDefinitionValidator {

  /** Signal names as accepted by {@code kill -s} (with or without the SIG prefix). */
  private static final Pattern SIGNAL_PATTERN = Pattern.compile("[A-Z][A-Z0-9]{0,9}");

  private DaemonDefinitionValidator() {}

  static void requireValidRegex(String regex, String field) {
    if (regex == null) {
      return;
    }
    try {
      Pattern.compile(regex);
    } catch (PatternSyntaxException e) {
      throw new BadRequestException("Invalid " + field + " regex: " + e.getMessage());
    }
  }

  static String normalizeStopSignal(String stopSignal) {
    if (stopSignal == null || stopSignal.isBlank()) {
      return "TERM";
    }
    String normalized = stopSignal.trim().toUpperCase();
    if (normalized.startsWith("SIG")) {
      normalized = normalized.substring(3);
    }
    if (!SIGNAL_PATTERN.matcher(normalized).matches()) {
      throw new BadRequestException("Invalid stop signal: " + stopSignal);
    }
    return normalized;
  }

  static void requireValidObservers(List<LogObserver> observers) {
    if (observers == null) {
      return;
    }
    for (LogObserver observer : observers) {
      if (observer.kind == null) {
        throw new BadRequestException("Observer kind is required");
      }
      if (observer.kind == LogObserverKind.PATTERN
          && (observer.pattern == null || observer.pattern.isBlank())) {
        throw new BadRequestException("PATTERN observers require a pattern");
      }
      requireValidRegex(observer.pattern, "observer pattern");
    }
  }
}
