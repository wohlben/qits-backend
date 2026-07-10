package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
import eu.wohlben.qits.domain.daemon.entity.WebView;
import eu.wohlben.qits.domain.error.BadRequestException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Shared field validation for daemon definitions of both scopes. Regexes are compiled at definition
 * time so a broken pattern fails the request, not the supervisor's reader thread.
 */
final class DaemonDefinitionValidator {

  /** Signal names as accepted by {@code kill -s} (with or without the SIG prefix). */
  private static final Pattern SIGNAL_PATTERN = Pattern.compile("[A-Z][A-Z0-9]{0,9}");

  private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s");

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

  /**
   * Normalizes and validates the three web-view fields into an embeddable, or null when the daemon
   * is not web-viewable (no port and no paths). Paths are normalized to no leading/trailing slashes
   * (blank or {@code /} means unset) and rejected lexically when they could escape the served base
   * or break the env-var/URL composition — so a broken value fails the request, not the proxy.
   */
  static WebView requireValidWebView(Integer port, String entryPath, String basePath) {
    String normalizedEntryPath = normalizeWebViewPath(entryPath, "webView.entryPath");
    String normalizedBasePath = normalizeWebViewPath(basePath, "webView.basePath");
    if (port == null) {
      if (normalizedEntryPath != null || normalizedBasePath != null) {
        throw new BadRequestException(
            "webView.port is required when an entryPath or basePath is set");
      }
      return null;
    }
    if (port < 1 || port > 65535) {
      throw new BadRequestException("webView.port must be between 1 and 65535: " + port);
    }
    WebView webView = new WebView();
    webView.port = port;
    webView.entryPath = normalizedEntryPath;
    webView.basePath = normalizedBasePath;
    return webView;
  }

  /**
   * Strips surrounding slashes ({@code /greeting/} → {@code greeting}); blank or bare {@code /}
   * normalizes to null (the app root). The value lands verbatim in {@code $QITS_PUBLIC_BASE} and
   * the frame URL, so backslashes, whitespace, empty segments and {@code ..} are rejected.
   */
  private static String normalizeWebViewPath(String path, String field) {
    if (path == null) {
      return null;
    }
    String normalized = path.trim();
    while (normalized.startsWith("/")) {
      normalized = normalized.substring(1);
    }
    while (normalized.endsWith("/")) {
      normalized = normalized.substring(0, normalized.length() - 1);
    }
    if (normalized.isEmpty()) {
      return null;
    }
    if (normalized.contains("\\") || WHITESPACE_PATTERN.matcher(normalized).find()) {
      throw new BadRequestException("Invalid " + field + ": " + path);
    }
    for (String segment : normalized.split("/")) {
      if (segment.isEmpty() || segment.equals("..")) {
        throw new BadRequestException("Invalid " + field + ": " + path);
      }
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

  private static final Pattern EXPECT_STATUS_TOKEN = Pattern.compile("[1-5]xx|\\d{3}");

  private static final int MAX_HEALTH_CHECKS = 20;

  /**
   * Healthchecks are validated per kind — fields that only make sense for another kind are rejected
   * rather than silently ignored (the {@code requireValidWebView} philosophy: a broken definition
   * fails the request, not the prober). Names must be unique because the supervisor's runtime state
   * and the instance DTO align to declared checks by name.
   */
  static void requireValidHealthChecks(List<HealthCheck> healthChecks) {
    if (healthChecks == null) {
      return;
    }
    if (healthChecks.size() > MAX_HEALTH_CHECKS) {
      throw new BadRequestException("At most " + MAX_HEALTH_CHECKS + " health checks per daemon");
    }
    Set<String> names = new HashSet<>();
    for (HealthCheck check : healthChecks) {
      if (check.name == null || check.name.isBlank()) {
        throw new BadRequestException("Health checks require a name");
      }
      String name = check.name.trim();
      if (name.length() > 255) {
        throw new BadRequestException("Health check name too long: " + name);
      }
      if (!names.add(name)) {
        throw new BadRequestException("Duplicate health check name: " + name);
      }
      if (check.kind == null) {
        throw new BadRequestException("Health check '" + name + "' requires a kind");
      }
      switch (check.kind) {
        case HTTP -> {
          requireHealthCheckPort(check, name);
          requireAbsent(check.command, "command", name, "HTTP checks take port/path");
          validateHttpPath(check, name);
          validateExpectStatus(check, name);
        }
        case TCP -> {
          requireHealthCheckPort(check, name);
          requireAbsent(check.path, "path", name, "TCP checks only connect to a port");
          requireAbsent(check.expectStatus, "expectStatus", name, "TCP checks only connect");
          requireAbsent(check.command, "command", name, "TCP checks only connect to a port");
        }
        case COMMAND -> {
          if (check.command == null || check.command.isBlank()) {
            throw new BadRequestException("Health check '" + name + "' requires a command");
          }
          if (check.command.length() > 4000) {
            throw new BadRequestException("Health check '" + name + "' command too long");
          }
          if (check.port != null) {
            throw new BadRequestException(
                "Health check '" + name + "': COMMAND checks take a command, not a port");
          }
          requireAbsent(check.path, "path", name, "COMMAND checks take a command");
          requireAbsent(check.expectStatus, "expectStatus", name, "COMMAND checks take a command");
        }
      }
      requireInRange(check.intervalMs, 250, 3_600_000, "intervalMs", name);
      requireInRange(check.timeoutMs, 100, 60_000, "timeoutMs", name);
      requireInRange(
          check.healthyThreshold == null ? null : check.healthyThreshold.longValue(),
          1,
          10,
          "healthyThreshold",
          name);
      requireInRange(
          check.unhealthyThreshold == null ? null : check.unhealthyThreshold.longValue(),
          1,
          10,
          "unhealthyThreshold",
          name);
      requireInRange(check.initialDelayMs, 0, 600_000, "initialDelayMs", name);
    }
  }

  private static void requireHealthCheckPort(HealthCheck check, String name) {
    if (check.port == null) {
      throw new BadRequestException(
          "Health check '" + name + "' (" + check.kind + ") requires a port");
    }
    if (check.port < 1 || check.port > 65535) {
      throw new BadRequestException(
          "Health check '" + name + "' port must be between 1 and 65535: " + check.port);
    }
  }

  /** The path lands verbatim in the curl URL (argv, no shell) — keep it a sane URL path anyway. */
  private static void validateHttpPath(HealthCheck check, String name) {
    if (check.path == null) {
      return;
    }
    String path = check.path;
    if (!path.startsWith("/")
        || WHITESPACE_PATTERN.matcher(path).find()
        || path.contains("\\")
        || path.contains("'")
        || path.contains("\"")
        || path.chars().anyMatch(Character::isISOControl)) {
      throw new BadRequestException("Health check '" + name + "': invalid path: " + path);
    }
  }

  private static void validateExpectStatus(HealthCheck check, String name) {
    if (check.expectStatus == null || check.expectStatus.isBlank()) {
      return;
    }
    for (String token : check.expectStatus.split(",")) {
      String trimmed = token.trim().toLowerCase();
      if (!EXPECT_STATUS_TOKEN.matcher(trimmed).matches()
          || (trimmed.matches("\\d{3}")
              && (Integer.parseInt(trimmed) < 100 || Integer.parseInt(trimmed) > 599))) {
        throw new BadRequestException(
            "Health check '" + name + "': invalid expectStatus token: " + token.trim());
      }
    }
  }

  private static void requireAbsent(String value, String field, String name, String hint) {
    if (value != null && !value.isBlank()) {
      throw new BadRequestException(
          "Health check '" + name + "': " + field + " is not allowed (" + hint + ")");
    }
  }

  private static void requireInRange(Long value, long min, long max, String field, String name) {
    if (value == null) {
      return;
    }
    if (value < min || value > max) {
      throw new BadRequestException(
          "Health check '" + name + "': " + field + " must be between " + min + " and " + max);
    }
  }
}
