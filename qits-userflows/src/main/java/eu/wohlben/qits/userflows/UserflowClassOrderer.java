package eu.wohlben.qits.userflows;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import org.junit.jupiter.api.ClassDescriptor;
import org.junit.jupiter.api.ClassOrderer;
import org.junit.jupiter.api.ClassOrdererContext;

/**
 * Orders story classes so every {@link UserflowPrecondition} class runs before its dependents — a
 * topological sort of the precondition graph, with a stable by-name tiebreak so unrelated classes
 * keep a deterministic order.
 *
 * <p>Registered as the global default class orderer via {@code
 * src/test/resources/junit-platform.properties} ({@code
 * junit.jupiter.testclass.order.default=eu.wohlben.qits.userflows.UserflowClassOrderer}). It orders
 * the top-level classes of one run, so a chain's producer and dependents must be the <b>same
 * kind</b> (all {@code *Test}, or all {@code *IT}) — surefire and failsafe are separate runs. An
 * edge to a precondition class that is not in the current run is dropped from ordering; that
 * dependent then simply skips at runtime (its precondition never passed).
 */
public final class UserflowClassOrderer implements ClassOrderer {

  @Override
  public void orderClasses(ClassOrdererContext context) {
    List<? extends ClassDescriptor> descriptors = context.getClassDescriptors();

    Map<Class<?>, ClassDescriptor> present = new LinkedHashMap<>();
    for (ClassDescriptor descriptor : descriptors) {
      present.put(descriptor.getTestClass(), descriptor);
    }

    Map<Class<?>, List<Class<?>>> dependents = new HashMap<>();
    Map<Class<?>, Integer> indegree = new HashMap<>();
    for (Class<?> storyClass : present.keySet()) {
      dependents.put(storyClass, new ArrayList<>());
      indegree.put(storyClass, 0);
    }
    for (Class<?> storyClass : present.keySet()) {
      // both precondition (gating) and runs-after (ordering-only) edges drive the order
      for (Class<?> producer : UserStoryExtension.orderingPredecessorsOf(storyClass)) {
        if (present.containsKey(producer)) { // ignore edges to classes not in this run
          dependents.get(producer).add(storyClass);
          indegree.merge(storyClass, 1, Integer::sum);
        }
      }
    }

    // Kahn's algorithm; ties broken by class name so the order is deterministic.
    PriorityQueue<Class<?>> ready = new PriorityQueue<>(Comparator.comparing(Class::getName));
    indegree.forEach(
        (storyClass, degree) -> {
          if (degree == 0) {
            ready.add(storyClass);
          }
        });
    Map<Class<?>, Integer> position = new HashMap<>();
    int next = 0;
    while (!ready.isEmpty()) {
      Class<?> storyClass = ready.poll();
      position.put(storyClass, next++);
      for (Class<?> dependent : dependents.get(storyClass)) {
        if (indegree.merge(dependent, -1, Integer::sum) == 0) {
          ready.add(dependent);
        }
      }
    }

    if (position.size() != present.size()) {
      List<String> inCycle =
          present.keySet().stream()
              .filter(storyClass -> !position.containsKey(storyClass))
              .map(Class::getName)
              .sorted()
              .toList();
      throw new IllegalStateException("cyclic @UserflowPrecondition graph among: " + inCycle);
    }

    descriptors.sort(
        Comparator.comparingInt(descriptor -> position.get(descriptor.getTestClass())));
  }
}
