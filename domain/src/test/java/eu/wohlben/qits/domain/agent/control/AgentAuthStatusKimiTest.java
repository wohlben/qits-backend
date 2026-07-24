package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Kimi auth probe: credential-file presence under the real volume home (no auth status CLI).
 */
@QuarkusTest
@TestProfile(AgentAuthStatusKimiTest.KimiProfile.class)
public class AgentAuthStatusKimiTest {

  private static final String KIMI_HOME = "/tmp/qits-test-kimi-home/.kimi-code";

  public static class KimiProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      // The harness is passed to isLoggedIn now; only the credential-mount override remains.
      return Map.of("qits.workspace.claude-mount", "/tmp/qits-test-kimi-home");
    }
  }

  @Inject AgentAuthStatus agentAuthStatus;

  @Inject ContainerRuntime containers;

  @Test
  public void credentialFilePresenceDecidesTheLogin() throws IOException {
    String repoId = "11111111-1111-1111-1111-111111111111";
    containers.run(repoId, "work", "master", null);
    // The fake exec chdirs into the workspace dir (env -C), which only a git clone would create.
    Files.createDirectories(
        Path.of("data/repositories", repoId, "workspaces", "work").toAbsolutePath());
    Path credentials = Path.of(KIMI_HOME, "credentials");
    Files.deleteIfExists(credentials);

    assertFalse(agentAuthStatus.isLoggedIn(repoId, "work", AgentType.KIMI), "no credentials yet");

    Files.createDirectories(credentials.getParent());
    Files.writeString(credentials, "{}");
    assertTrue(
        agentAuthStatus.isLoggedIn(repoId, "work", AgentType.KIMI),
        "legacy flat credentials file present");

    Files.deleteIfExists(credentials);
  }

  /**
   * Regression: kimi 0.28+ stores the token as {@code credentials/kimi-code.json} — {@code
   * credentials} is a directory there, so a plain {@code test -f} on it misreads a signed-in volume
   * as logged out (every launch redirected to an instantly-exiting {@code kimi login}).
   */
  @Test
  public void directoryLayoutCredentialsCountAsLoggedIn() throws IOException {
    String repoId = "33333333-3333-3333-3333-333333333333";
    containers.run(repoId, "work", "master", null);
    Files.createDirectories(
        Path.of("data/repositories", repoId, "workspaces", "work").toAbsolutePath());
    Path tokenFile = Path.of(KIMI_HOME, "credentials", "kimi-code.json");
    Files.createDirectories(tokenFile.getParent());

    Files.writeString(tokenFile, "{}");
    assertTrue(
        agentAuthStatus.isLoggedIn(repoId, "work", AgentType.KIMI),
        "credentials/kimi-code.json present");

    Files.deleteIfExists(tokenFile);
    Files.deleteIfExists(tokenFile.getParent());
  }

  @Test
  public void aMissingContainerReadsAsNotSignedIn() {
    assertFalse(
        agentAuthStatus.isLoggedIn(
            "22222222-2222-2222-2222-222222222222", "never-created", AgentType.KIMI));
  }
}
