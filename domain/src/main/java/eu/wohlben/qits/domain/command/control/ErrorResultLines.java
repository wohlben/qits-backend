package eu.wohlben.qits.domain.command.control;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The one stream-json shape the UI renders that the harness transcript does not contain: a failure
 * {@code result} event. {@link ChatSession} persists exactly these to {@code OUTPUT}, and the
 * finished-chat replay merges exactly these back into the transcript — one predicate, both sides.
 */
final class ErrorResultLines {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private ErrorResultLines() {}

  /** Mirrors the frontend error-bubble predicate: {@code is_error} or {@code subtype=="error"}. */
  static boolean isErrorResult(String line) {
    if (line == null || !line.contains("\"type\":\"result\"")) {
      return false; // substring pre-check keeps the hot path parse-free.
    }
    JsonNode node;
    try {
      node = MAPPER.readTree(line);
    } catch (JsonProcessingException e) {
      return false;
    }
    return "result".equals(node.path("type").asText())
        && (node.path("is_error").asBoolean(false)
            || "error".equals(node.path("subtype").asText()));
  }
}
