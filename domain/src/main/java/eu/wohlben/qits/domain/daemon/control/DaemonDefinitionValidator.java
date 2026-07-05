package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
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

  static void requireValidHttpPort(Integer httpPort) {
    if (httpPort != null && (httpPort < 1 || httpPort > 65535)) {
      throw new BadRequestException("httpPort must be between 1 and 65535: " + httpPort);
    }
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

  /**
   * FILE source paths are workspace-relative and untrusted, so traversal is rejected lexically at
   * definition time (the tail re-checks containment at runtime against the resolved workspace root,
   * mirroring the file browser's guard).
   */
  static void requireValidSources(List<LogSource> sources) {
    if (sources == null) {
      return;
    }
    for (LogSource source : sources) {
      if (source.path == null || source.path.isBlank()) {
        throw new BadRequestException("Log sources require a path");
      }
      String path = source.path;
      if (path.startsWith("/") || path.contains("\\")) {
        throw new BadRequestException("Log source path must be workspace-relative: " + path);
      }
      for (String segment : path.split("/")) {
        if (segment.isEmpty() || segment.equals("..")) {
          throw new BadRequestException("Invalid log source path: " + path);
        }
      }
      if (path.equals(".git") || path.startsWith(".git/")) {
        throw new BadRequestException("Log source path may not point into .git: " + path);
      }
    }
  }
}
