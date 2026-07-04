package eu.wohlben.qits.domain.daemon.control;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * The production {@link LogClassifier}: one direct Anthropic Messages API call per batch, using a
 * cheap model (Haiku) with the stable system prompt marked {@code cache_control: ephemeral} so
 * repeat calls while a daemon logs steadily pay mostly the cached rate. Hand-rolled over {@link
 * HttpClient} + Jackson (already on the classpath) rather than pulling in the {@code com.anthropic}
 * SDK for a single endpoint — the interface keeps a swap trivial. Disabled (never called by the
 * observer) when no API key is configured.
 */
@ApplicationScoped
public class AnthropicLogClassifier implements LogClassifier {

  private static final Logger LOG = Logger.getLogger(AnthropicLogClassifier.class);

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

  /**
   * The stable per-observer prefix: classification rules, the strict output contract, and enough
   * framework-specific error examples to both guide the model and clear the 1,024-token minimum for
   * prompt caching.
   */
  static final String DEFAULT_SYSTEM_PROMPT =
      """
      You are a log-triage classifier watching the output of a long-running development process \
      (a dev server, compile watcher, or test runner in watch mode). You receive one batch of \
      recent log lines. Your job is to decide whether the batch contains a REAL problem worth \
      interrupting a developer (or their coding agent) for, and if so, to classify it.

      Output contract — reply with EXACTLY one line and nothing else:
      - If the batch contains no real problem, reply exactly: NONE
      - Otherwise reply: SEVERITY|error-type|one-line-summary|first-line-offset
        where SEVERITY is one of INFO, WARNING, ERROR;
        error-type is a short kebab-case or CamelCase identifier of the problem class \
      (e.g. NullPointerException, compile-error, port-in-use, unhandled-rejection);
        one-line-summary is a single sentence (no pipes, no newlines) a developer can act on;
        first-line-offset is the 0-based index of the first log line in the batch that shows \
      the problem.

      Severity rules:
      - ERROR: the process cannot do its job — crashes, unhandled exceptions, compile/build \
      failures, failed startup, port already in use, out of memory, database connection refused, \
      test-runner crash (not individual test failures in watch mode — those are WARNING).
      - WARNING: degraded but working — deprecation warnings repeated at volume, failing tests \
      in watch mode, slow-query warnings, retry storms, low disk space warnings.
      - INFO: only when a batch matched a naive keyword filter but the "error" is routine \
      (e.g. a request log line for a URL containing the word "error", an HTTP 404 for a \
      favicon, a library banner mentioning "0 errors"). Prefer NONE over INFO when in doubt.

      Judgment rules:
      - HTTP access-log lines with 2xx/3xx statuses are never problems. 4xx lines are normal \
      client noise (NONE) unless they clearly repeat against a route that should exist. 5xx \
      lines are ERROR.
      - A stack trace (Java "at ...", Python "Traceback (most recent call last)", Node \
      "    at ...") is the strongest signal; the offset should point at its first line \
      (the exception/Traceback line, not the frames).
      - Compiler/watcher noise like "webpack compiled successfully", "Found 0 errors. \
      Watching for file changes." is NONE even though it contains the word "errors".
      - If the batch shows the SAME problem multiple times, classify it once; the summary may \
      note the repetition.

      Examples (input → output):
      - "GET /api/users 200 12ms" → NONE
      - "webpack 5.90 compiled successfully in 421 ms" → NONE
      - "Found 0 errors. Watching for file changes." → NONE
      - "Exception in thread \\"main\\" java.lang.NullPointerException: Cannot invoke \
      \\"String.length()\\" because \\"s\\" is null\\n\\tat com.example.Api.handle(Api.java:42)" \
      → ERROR|NullPointerException|NPE in com.example.Api.handle (Api.java:42): s is null|0
      - "Traceback (most recent call last):\\n  File \\"app.py\\", line 10, in index\\n    \
      return 1/0\\nZeroDivisionError: division by zero" \
      → ERROR|ZeroDivisionError|Unhandled ZeroDivisionError in app.py index (line 10)|0
      - "Error: listen EADDRINUSE: address already in use :::3000" \
      → ERROR|port-in-use|Port 3000 is already in use; the server could not bind|0
      - "TS2339: Property 'foo' does not exist on type 'Bar'." \
      → ERROR|compile-error|TypeScript: Property 'foo' does not exist on type 'Bar' (TS2339)|0
      - "FAIL src/app.spec.ts — 2 tests failed, 14 passed" \
      → WARNING|test-failure|2 tests failing in src/app.spec.ts under watch mode|0
      - "(node:1234) [DEP0123] DeprecationWarning: ..." repeated 40 times \
      → WARNING|deprecation-storm|DEP0123 deprecation warning repeating at volume|0
      - "GET /error-page.html 404 2ms" → NONE
      - "psycopg2.OperationalError: connection to server at \\"localhost\\" failed: Connection \
      refused" → ERROR|db-connection-refused|PostgreSQL connection refused on localhost; \
      database appears down|0

      Never explain, never add prose, never wrap in markdown. One line, exactly as specified.
      """;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();

  @ConfigProperty(name = "qits.anthropic.api-key")
  Optional<String> apiKey;

  @ConfigProperty(name = "qits.anthropic.base-url", defaultValue = "https://api.anthropic.com")
  String baseUrl;

  @ConfigProperty(
      name = "qits.daemons.classifier-model",
      defaultValue = "claude-haiku-4-5-20251001")
  String model;

  @Override
  public boolean enabled() {
    return apiKey.filter(key -> !key.isBlank()).isPresent();
  }

  @Override
  public Optional<Classification> classify(String promptOverride, String logBatch) {
    if (!enabled()) {
      return Optional.empty();
    }
    String systemPrompt =
        promptOverride == null || promptOverride.isBlank() ? DEFAULT_SYSTEM_PROMPT : promptOverride;
    try {
      Map<String, Object> body =
          Map.of(
              "model",
              model,
              "max_tokens",
              200,
              "system",
              List.of(
                  Map.of(
                      "type",
                      "text",
                      "text",
                      systemPrompt,
                      "cache_control",
                      Map.of("type", "ephemeral"))),
              "messages",
              List.of(Map.of("role", "user", "content", logBatch)));
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
              .header("x-api-key", apiKey.orElseThrow())
              .header("anthropic-version", "2023-06-01")
              .header("content-type", "application/json")
              .timeout(REQUEST_TIMEOUT)
              .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
              .build();
      HttpResponse<String> response =
          httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200) {
        LOG.warnf(
            "Anthropic classification call failed (%d): %.300s",
            response.statusCode(), response.body());
        return Optional.empty();
      }
      JsonNode content = mapper.readTree(response.body()).path("content");
      String text =
          content.isArray() && !content.isEmpty() ? content.get(0).path("text").asText() : "";
      return parse(text);
    } catch (IOException e) {
      LOG.warnf(e, "Anthropic classification call failed");
      return Optional.empty();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return Optional.empty();
    }
  }

  /** Parses the strict {@code NONE} / {@code SEVERITY|type|summary|offset} contract, leniently. */
  static Optional<Classification> parse(String text) {
    String line = text == null ? "" : text.strip();
    if (line.isEmpty() || line.equalsIgnoreCase("NONE")) {
      return Optional.empty();
    }
    String[] parts = line.split("\\|", 4);
    if (parts.length < 3) {
      LOG.warnf("Unparseable classifier reply dropped: %.200s", line);
      return Optional.empty();
    }
    DaemonEventSeverity severity;
    try {
      severity = DaemonEventSeverity.valueOf(parts[0].strip().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      LOG.warnf("Classifier reply with unknown severity dropped: %.200s", line);
      return Optional.empty();
    }
    int offset = 0;
    if (parts.length == 4) {
      try {
        offset = Integer.parseInt(parts[3].strip());
      } catch (NumberFormatException ignored) {
        // Lenient: a malformed offset defaults to the batch start.
      }
    }
    return Optional.of(new Classification(severity, parts[1].strip(), parts[2].strip(), offset));
  }
}
