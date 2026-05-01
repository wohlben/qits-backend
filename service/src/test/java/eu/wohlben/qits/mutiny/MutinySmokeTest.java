package eu.wohlben.qits.mutiny;

import io.quarkus.test.junit.QuarkusTest;
import io.smallrye.mutiny.Multi;
import io.smallrye.mutiny.Uni;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
public class MutinySmokeTest {

    @Test
    public void uniMapAndAwait() {
        String result = Uni.createFrom().item("hello")
            .map(String::toUpperCase)
            .await().atMost(Duration.ofSeconds(5));
        assertEquals("HELLO", result);
    }

    @Test
    public void uniFlatMapChain() {
        String result = Uni.createFrom().item("world")
            .flatMap(v -> Uni.createFrom().item("hello " + v))
            .await().atMost(Duration.ofSeconds(5));
        assertEquals("hello world", result);
    }

    @Test
    public void uniFailureRecovery() {
        String result = Uni.createFrom().<String>failure(new RuntimeException("boom"))
            .onFailure().recoverWithItem("recovered")
            .await().atMost(Duration.ofSeconds(5));
        assertEquals("recovered", result);
    }

    @Test
    public void multiCollectAndAwait() {
        List<Integer> result = Multi.createFrom().items(1, 2, 3)
            .map(n -> n * 2)
            .collect().asList()
            .await().atMost(Duration.ofSeconds(5));
        assertEquals(List.of(2, 4, 6), result);
    }

    @Test
    public void uniCombineAll() {
        Uni<String> a = Uni.createFrom().item("a");
        Uni<String> b = Uni.createFrom().item("b");

        String result = Uni.combine().all().unis(a, b)
            .with((x, y) -> x + y)
            .await().atMost(Duration.ofSeconds(5));
        assertEquals("ab", result);
    }

    @Test
    public void uniInvokeSideEffectDoesNotChangeItem() {
        StringBuilder sb = new StringBuilder();
        String result = Uni.createFrom().item("x")
            .invoke(sb::append)
            .await().atMost(Duration.ofSeconds(5));
        assertEquals("x", result);
        assertEquals("x", sb.toString());
    }

    @Test
    public void uniRetryAtMost() {
        int[] count = {0};
        String result = Uni.createFrom().<String>emitter(e -> {
            count[0]++;
            if (count[0] < 3) {
                e.fail(new RuntimeException("retry me"));
            } else {
                e.complete("ok");
            }
        })
            .onFailure().retry().atMost(3)
            .await().atMost(Duration.ofSeconds(5));
        assertEquals("ok", result);
        assertEquals(3, count[0]);
    }
}
