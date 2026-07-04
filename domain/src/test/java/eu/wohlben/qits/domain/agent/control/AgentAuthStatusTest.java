package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Pure tests for reading the {@code claude auth status} result. */
public class AgentAuthStatusTest {

  @Test
  public void signedInIsReadFromTheJsonField() {
    assertTrue(
        AgentAuthStatus.parseLoggedIn(0, "{\"loggedIn\": true, \"authMethod\": \"claudeai\"}"));
  }

  @Test
  public void signedOutIsReadFromTheJsonField() {
    // The field wins even if some future build exits 0 while reporting signed out.
    assertFalse(
        AgentAuthStatus.parseLoggedIn(0, "{\"loggedIn\": false, \"authMethod\": \"none\"}"));
  }

  @Test
  public void fallsBackToTheExitCodeWithoutTheField() {
    assertTrue(AgentAuthStatus.parseLoggedIn(0, "unexpected non-json output"));
    // e.g. claude not on PATH in a stale image.
    assertFalse(AgentAuthStatus.parseLoggedIn(127, "claude: not found"));
  }
}
