package eu.wohlben.qits.domain.daemon.control;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.jboss.logging.Logger;

/**
 * The LOG_LEVEL observer: buffers observed lines and, after a debounce (idle gap or size cap),
 * classifies the batch locally via {@link LogClassifier} — one finding per burst instead of one per
 * line, with the excerpt starting at the reported offset. The finding anchors to its source: the
 * position range from the classified line to the batch's last line. One instance per (observer,
 * source), so a batch is always a contiguous range of a single source. Throttled like the PATTERN
 * observer so a crash-looping daemon can't flood the feed or the agent's chat. Classification runs
 * on the supervisor's scheduler, never on the producer's thread.
 */
final class LogLevelObserver implements ObservedLineListener {

  private static final Logger LOG = Logger.getLogger(LogLevelObserver.class);

  /** Flush a batch after this much idle time on the stream. */
  private static final long DEBOUNCE_MILLIS = 2_000;

  /** …or immediately once the buffered batch reaches this size. */
  private static final int MAX_BATCH_CHARS = 16 * 1024;

  /** At most one finding per observer per this interval; suppressed batches are dropped. */
  private static final long THROTTLE_MILLIS = 10_000;

  private final LogClassifier classifier;
  private final ScheduledExecutorService scheduler;
  private final Consumer<ObserverFinding> onFinding;

  private final List<ObservedLine> pending = new ArrayList<>();
  private int pendingChars;
  private ScheduledFuture<?> flushTask;
  private volatile long lastEmitMillis;

  LogLevelObserver(
      LogClassifier classifier,
      ScheduledExecutorService scheduler,
      Consumer<ObserverFinding> onFinding) {
    this.classifier = classifier;
    this.scheduler = scheduler;
    this.onFinding = onFinding;
  }

  @Override
  public synchronized void onLine(ObservedLine line) {
    pending.add(line);
    pendingChars += line.content().length();
    if (flushTask != null) {
      flushTask.cancel(false);
    }
    if (pendingChars >= MAX_BATCH_CHARS) {
      List<ObservedLine> batch = takeBatch();
      scheduler.execute(() -> classify(batch));
    } else {
      flushTask = scheduler.schedule(this::flush, DEBOUNCE_MILLIS, TimeUnit.MILLISECONDS);
    }
  }

  private void flush() {
    List<ObservedLine> batch;
    synchronized (this) {
      batch = takeBatch();
    }
    classify(batch);
  }

  private synchronized List<ObservedLine> takeBatch() {
    List<ObservedLine> batch = List.copyOf(pending);
    pending.clear();
    pendingChars = 0;
    flushTask = null;
    return batch;
  }

  /**
   * Runs on the scheduler, off the producer's thread; a failed classification is logged and
   * dropped.
   */
  private void classify(List<ObservedLine> batch) {
    if (batch.isEmpty()) {
      return;
    }
    long now = System.currentTimeMillis();
    if (now - lastEmitMillis < THROTTLE_MILLIS) {
      return;
    }
    try {
      String joined = batch.stream().map(ObservedLine::content).collect(Collectors.joining("\n"));
      classifier
          .classify(joined)
          .ifPresent(
              classification -> {
                lastEmitMillis = now;
                int offset =
                    Math.clamp(classification.firstLineOffset(), 0, Math.max(0, batch.size() - 1));
                List<ObservedLine> anchored = batch.subList(offset, batch.size());
                String excerpt =
                    anchored.stream().map(ObservedLine::content).collect(Collectors.joining("\n"));
                if (excerpt.length() > 2000) {
                  excerpt = excerpt.substring(0, 2000);
                }
                onFinding.accept(
                    new ObserverFinding(
                        classification.severity(),
                        classification.errorType(),
                        classification.summary(),
                        excerpt,
                        batch.getFirst().source(),
                        anchored.getFirst().position(),
                        anchored.getLast().position(),
                        batch.getFirst().sourceEpoch()));
              });
    } catch (RuntimeException e) {
      LOG.warnf(e, "Log classification failed; dropping batch of %d lines", batch.size());
    }
  }
}
