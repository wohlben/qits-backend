package eu.wohlben.qits.domain.agent.control;

import static eu.wohlben.qits.domain.agent.control.McpServers.httpMcp;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Pure-renderer tests for the coding-agent builder — no CDI, just the shell it produces. */
public class CodingAgentFactoryTest {

  private static final String ACTIONS_URL =
      "http://localhost:8080/mcp/actions?repositoryId=11111111-1111-1111-1111-111111111111";

  @Test
  public void interactiveWithoutMcpJustExecsClaude() {
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).start();

    assertEquals("exec claude", spec.script());
    assertTrue(spec.interactive());
  }

  @Test
  public void flatOutputAddsTheScreenReaderFlag() {
    // Opt-in (off by default); renders flat text so a captured PTY session log stays readable.
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).flatOutput().start();

    assertEquals("exec claude --ax-screen-reader", spec.script());
  }

  @Test
  public void interactiveWithMcpRendersStrictConfigAndAllowlist() {
    LaunchSpec spec =
        CodingAgentFactory.ofType(AgentType.CLAUDE)
            .mcpServer("actions", httpMcp(ACTIONS_URL))
            .allowedTools(
                List.of("mcp__actions__listGlobalActions", "mcp__actions__getGlobalAction"))
            .start();

    String cmd = spec.script();
    assertTrue(cmd.startsWith("exec claude "), cmd);
    assertTrue(cmd.contains("--strict-mcp-config"), cmd);
    assertTrue(
        cmd.contains(
            "--mcp-config '{\"mcpServers\":{\"actions\":{\"type\":\"http\",\"url\":\""
                + ACTIONS_URL
                + "\"}}}'"),
        cmd);
    assertTrue(
        cmd.contains(
            "--allowedTools 'mcp__actions__listGlobalActions,mcp__actions__getGlobalAction'"),
        cmd);
  }

  @Test
  public void interactiveWithInitialContextEmbedsTheSeedDirectly() {
    LaunchSpec spec =
        CodingAgentFactory.ofType(AgentType.CLAUDE)
            .initialContext("please look at the failing test")
            .start();

    assertEquals("exec claude 'please look at the failing test'", spec.script());
  }

  @Test
  public void runRendersPrintModeWithTheEmbeddedPrompt() {
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).run("resolve the conflict");

    assertEquals("claude -p 'resolve the conflict'", spec.script());
    assertFalse(spec.interactive());
  }

  @Test
  public void promptWithShellMetacharactersStaysASingleArgument() {
    // An untrusted prompt (e.g. built from attacker-controlled commit messages) full of shell
    // metacharacters: a single quote, a command separator, a command substitution and backticks.
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).run("a'b`c$(d);e");

    // POSIX single-quoting neutralizes all of them: everything is literal inside '…', and the one
    // embedded ' is escaped as '\'' so it can't close the quote early. The whole prompt is one arg
    // —
    // no separator runs, no substitution expands.
    assertEquals("claude -p 'a'\\''b`c$(d);e'", spec.script());
  }

  @Test
  public void modelFlagRendersOnEveryLaunchVariant() {
    assertEquals(
        "claude -p 'hi' --model 'haiku'",
        CodingAgentFactory.ofType(AgentType.CLAUDE).model("haiku").run("hi").script());
    assertEquals(
        "exec claude --model 'haiku'",
        CodingAgentFactory.ofType(AgentType.CLAUDE).model("haiku").start().script());
    assertTrue(
        CodingAgentFactory.ofType(AgentType.CLAUDE)
            .model("haiku")
            .chat()
            .script()
            .endsWith(" --model 'haiku'"));
  }

  @Test
  public void modelFlagIsAbsentWhenUnset() {
    assertFalse(CodingAgentFactory.ofType(AgentType.CLAUDE).run("hi").script().contains("--model"));
  }

  @Test
  public void chatRendersTheStreamJsonProtocol() {
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).chat();

    assertEquals(
        "exec claude --print --input-format stream-json --output-format stream-json"
            + " --include-hook-events --verbose",
        spec.script());
    assertFalse(spec.interactive());
  }

  @Test
  public void skipPermissionsAddsTheAutonomousFlag() {
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).skipPermissions().run("go");

    assertTrue(spec.script().endsWith(" --dangerously-skip-permissions"), spec.script());
  }

  @Test
  public void multipleMcpServersMergeIntoOneConfigAndOneAllowlist() {
    LaunchSpec spec =
        CodingAgentFactory.ofType(AgentType.CLAUDE)
            .mcpServer("actions", httpMcp(ACTIONS_URL))
            .allowedTools(List.of("mcp__actions__listGlobalActions"))
            .mcpServer("repository", httpMcp("http://localhost:8080/mcp/repository?projectId=p"))
            .allowedTools(List.of("mcp__repository__listBranches"))
            .start();

    String cmd = spec.script();
    // Both servers appear in one mcp-config object (insertion order)...
    assertTrue(cmd.contains("\"actions\":{"), cmd);
    assertTrue(cmd.contains("\"repository\":{"), cmd);
    // ...and every allowlist entry is joined into a single --allowedTools argument.
    assertTrue(
        cmd.contains(
            "--allowedTools 'mcp__actions__listGlobalActions,mcp__repository__listBranches'"),
        cmd);
  }
}
