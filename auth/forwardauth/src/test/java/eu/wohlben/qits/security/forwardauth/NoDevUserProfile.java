package eu.wohlben.qits.security.forwardauth;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/**
 * Blanks the %test dev-user fallback the module ships, so tests see the prod posture: no header =
 * anonymous = denied. (An empty value reads as absent for the Optional config property.)
 */
public class NoDevUserProfile implements QuarkusTestProfile {
  @Override
  public Map<String, String> getConfigOverrides() {
    return Map.of("qits.auth.forward.dev-user", "");
  }
}
