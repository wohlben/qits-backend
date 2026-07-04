package eu.wohlben.qits.domain.daemon.control;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.jboss.logging.Logger;

/**
 * The LOG_LEVEL observer: buffers output lines and, after a debounce (idle gap or size cap),
 * classifies the batch locally via {@link LogClassifier} — one finding per burst instead of one per
 * line, with the excerpt starting at the reported offset. Throttled like the PATTERN observer so a
 * crash-looping daemon can't flood the feed or the agent's chat. Classification runs on the
 * supervisor's scheduler, never on the session's reader thread.
 */
final class LogLevelObserver extends LineFramingSink {

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

  private final List<String> pending = new ArrayList<>();
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
  protected synchronized void onLine(String line) {
    pending.add(line);
    pendingChars += line.length();
    if (flushTask != null) {
      flushTask.cancel(false);
    }
    if (pendingChars >= MAX_BATCH_CHARS) {
      List<String> batch = takeBatch();
      scheduler.execute(() -> classify(batch));
    } else {
      flushTask = scheduler.schedule(this::flush, DEBOUNCE_MILLIS, TimeUnit.MILLISECONDS);
    }
  }

  private void flush() {
    List<String> batch;
    synchronized (this) {
      batch = takeBatch();
    }
    classify(batch);
  }

  private synchronized List<String> takeBatch() {
    List<String> batch = List.copyOf(pending);
    pending.clear();
    pendingChars = 0;
    flushTask = null;
    return batch;
  }

  /**
   * Runs on the scheduler, off the reader thread; a failed classification is logged and dropped.
   */
  private void classify(List<String> batch) {
    if (batch.isEmpty()) {
      return;
    }
    long now = System.currentTimeMillis();
    if (now - lastEmitMillis < THROTTLE_MILLIS) {
      return;
    }
    try {
      classifier
          .classify(String.join("\n", batch))
          .ifPresent(
              classification -> {
                lastEmitMillis = now;
                int offset =
                    Math.clamp(classification.firstLineOffset(), 0, Math.max(0, batch.size() - 1));
                String excerpt = String.join("\n", batch.subList(offset, batch.size()));
                if (excerpt.length() > 2000) {
                  excerpt = excerpt.substring(0, 2000);
                }
                onFinding.accept(
                    new ObserverFinding(
                        classification.severity(),
                        classification.errorType(),
                        classification.summary(),
                        excerpt));
              });
    } catch (RuntimeException e) {
      LOG.warnf(e, "Log classification failed; dropping batch of %d lines", batch.size());
    }
  }
}
