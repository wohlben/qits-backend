package eu.wohlben.qits.domain.agent.control;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reusable, harness-agnostic MCP server config objects. An MCP server is carried through a {@link
 * CodingAgent} as a {@code key → config} pair; these generators produce the {@code config} object
 * in the shape the MCP config format expects, so the same server definition can be attached to any
 * agent that speaks MCP (the agent serializes it however it must — only the outer flag wrapping is
 * agent-specific).
 */
public final class McpServers {

  private McpServers() {}

  /**
   * The config for an HTTP (Streamable HTTP) MCP server: {@code {"type":"http","url":"<url>"}}. The
   * {@code url}'s variable parts (scope ids) must already be validated by the caller, since an
   * agent may interpolate the serialized config into a shell argument (see {@code
   * AgentLaunchService}).
   */
  public static Map<String, Object> httpMcp(String url) {
    Map<String, Object> config = new LinkedHashMap<>();
    config.put("type", "http");
    config.put("url", url);
    return config;
  }
}
