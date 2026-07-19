package eu.wohlben.qits.userflows;

import java.util.Map;
import java.util.NoSuchElementException;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A shared key→value store for handing values from a producer story to the stories that depend on
 * it ({@link UserflowPrecondition}). Because each story runs in a fresh browser, produced state
 * lives server-side in qits; the context carries <b>references</b> to it — a created project's id,
 * a generated name, a URL — that a producer discovers (e.g. from {@code flow.page().url()}) and
 * stashes for its dependents.
 *
 * <p>Injected into a story method as a parameter alongside {@link Flow}. It is a single instance
 * shared for the whole test-JVM run (like the framework's other registries), so keys should be
 * <b>namespaced</b> by the producing flow — e.g. {@code "project.id"}. Dependent flows only run
 * after their precondition passed, so a required value is present by construction.
 */
public final class UserflowContext {

  private final Map<String, Object> values = new ConcurrentHashMap<>();

  UserflowContext() {}

  /** Stash a value under {@code key} (overwrites any previous value). */
  public void put(String key, Object value) {
    values.put(key, value);
  }

  /** Whether {@code key} has a value. */
  public boolean has(String key) {
    return values.containsKey(key);
  }

  /** The value under {@code key} as {@code type}, or {@code null} if absent. */
  public <T> T get(String key, Class<T> type) {
    return type.cast(values.get(key));
  }

  /** Convenience for the common string case; {@code null} if absent. */
  public String getString(String key) {
    return get(key, String.class);
  }

  /**
   * The value under {@code key} as {@code type}; throws if absent — use for handed-off values a
   * precondition guarantees.
   */
  public <T> T require(String key, Class<T> type) {
    if (!values.containsKey(key)) {
      throw new NoSuchElementException(
          "no userflow-context value for '" + key + "' — is the producing story a precondition?");
    }
    return get(key, type);
  }

  /** Test-only: drop all values (the framework does not reset between stories). */
  void clear() {
    values.clear();
  }
}
