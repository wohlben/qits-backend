package eu.wohlben.qits.domain.daemon.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * {@code tail -F} semantics of the file source: pre-existing content is skipped (but counted, so
 * positions are true line numbers), growth is picked up, truncation/recreation re-reads from the
 * top under a fresh epoch without duplicating events, and a file that appears only after the tail
 * started is read from its first line.
 */
public class FileTailSourceTest {

  private static final long POLL_MILLIS = 40;
  private static final long AWAIT_MILLIS = 5_000;

  @TempDir Path dir;

  private ScheduledExecutorService scheduler;
  private final List<ObservedLine> observed = new CopyOnWriteArrayList<>();
  private FileTailSource tail;

  @BeforeEach
  void setUp() {
    scheduler = Executors.newSingleThreadScheduledExecutor();
  }

  @AfterEach
  void tearDown() {
    if (tail != null) {
      tail.close();
    }
    scheduler.shutdownNow();
  }

  private FileTailSource tailOf(Path file) {
    tail = new FileTailSource(file, "app.log", List.of(observed::add), scheduler, POLL_MILLIS);
    return tail;
  }

  private void awaitObserved(int count) throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    while (System.currentTimeMillis() < deadline) {
      if (observed.size() >= count) {
        return;
      }
      Thread.sleep(20);
    }
    throw new AssertionError("timed out waiting for " + count + " lines; got " + observed);
  }

  @Test
  public void skipsHistoryButCountsItSoPositionsAreTrueLineNumbers() throws Exception {
    Path file = dir.resolve("app.log");
    Files.writeString(file, "old one\nold two\n");

    tailOf(file);
    Thread.sleep(POLL_MILLIS * 4);
    assertEquals(List.of(), observed, "history is not replayed as events");

    Files.writeString(file, "ERROR: fresh\n", StandardOpenOption.APPEND);
    awaitObserved(1);
    assertEquals("ERROR: fresh", observed.get(0).content());
    assertEquals(3, observed.get(0).position(), "positions continue after the skipped history");
    assertEquals("app.log", observed.get(0).source());
  }

  @Test
  public void truncationRewindsToTheTopUnderANewEpoch() throws Exception {
    Path file = dir.resolve("app.log");
    Files.writeString(file, "");
    tailOf(file);

    // Long enough that the rotated file is strictly smaller (size shrink marks the truncation).
    Files.writeString(file, "first line, quite long\n", StandardOpenOption.APPEND);
    awaitObserved(1);
    var beforeRotation = observed.get(0);
    assertEquals(1, beforeRotation.position());

    // Rotate: truncate and rewrite. The tail must keep tailing without replaying the old line.
    Files.writeString(file, "reborn\n", StandardOpenOption.TRUNCATE_EXISTING);
    awaitObserved(2);
    var afterRotation = observed.get(1);
    assertEquals("reborn", afterRotation.content());
    assertEquals(1, afterRotation.position(), "line numbers restart with the rotated file");
    assertNotEquals(
        beforeRotation.sourceEpoch(),
        afterRotation.sourceEpoch(),
        "a rotation opens a new epoch so old anchors don't mislead");
    assertEquals(2, observed.size(), "no duplicate events across the rotation");
  }

  @Test
  public void deletionThenRecreationIsARotation() throws Exception {
    Path file = dir.resolve("app.log");
    Files.writeString(file, "");
    tailOf(file);
    Files.writeString(file, "before\n", StandardOpenOption.APPEND);
    awaitObserved(1);

    Files.delete(file);
    Thread.sleep(POLL_MILLIS * 4);
    Files.writeString(file, "after\n");
    awaitObserved(2);
    assertEquals("after", observed.get(1).content());
    assertEquals(1, observed.get(1).position());
  }

  @Test
  public void aFileThatAppearsLateIsReadFromItsFirstLine() throws Exception {
    Path file = dir.resolve("late.log");
    tailOf(file);
    Thread.sleep(POLL_MILLIS * 4);

    Files.writeString(file, "line one\nERROR: line two\n");
    awaitObserved(2);
    assertEquals("line one", observed.get(0).content());
    assertEquals(1, observed.get(0).position(), "a late file has no history to skip");
    assertEquals("ERROR: line two", observed.get(1).content());
    assertEquals(2, observed.get(1).position());
    assertTrue(observed.get(1).sourceEpoch() != null, "file lines carry their epoch");
  }
}
