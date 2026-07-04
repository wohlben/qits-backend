package eu.wohlben.qits.domain.daemon.control;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;

/**
 * The MODEL observer: buffers output lines and, after a debounce (idle gap or size cap), sends one
 * classification call per batch — never per line. A regex pre-filter gates the model call entirely,
 * so quiet, healthy logs cost zero; and with no API key configured the whole observer is inert.
 * Classification runs on the supervisor's scheduler, never on the session's reader thread.
 */
final class ModelLogObserver extends LineFramingSink {

  private static final Logger LOG = Logger.getLogger(ModelLogObserver.class);

  /** Flush a batch after this much idle time on the stream. */
  private static final long DEBOUNCE_MILLIS = 2_000;

  /** …or immediately once the buffered batch reaches this size. */
  private static final int MAX_BATCH_CHARS = 16 * 1024;

  /** Only batches with at least one line matching this ever reach the model. */
  private static final Pattern PRE_FILTER =
      Pattern.compile("error|exception|warn|fail|fatal|panic|traceback", Pattern.CASE_INSENSITIVE);

  private final String promptOverride;
  private final LogClassifier classifier;
  private final ScheduledExecutorService scheduler;
  private final Consumer<ObserverFinding> onFinding;

  private final List<String> pending = new ArrayList<>();
  private int pendingChars;
  private ScheduledFuture<?> flushTask;

  ModelLogObserver(
      String promptOverride,
      LogClassifier classifier,
      ScheduledExecutorService scheduler,
      Consumer<ObserverFinding> onFinding) {
    this.promptOverride = promptOverride;
    this.classifier = classifier;
    this.scheduler = scheduler;
    this.onFinding = onFinding;
  }

  @Override
  protected synchronized void onLine(String line) {
    if (!classifier.enabled()) {
      return;
    }
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

  /** Runs on the scheduler, off the reader thread; a failed call is logged and dropped. */
  private void classify(List<String> batch) {
    if (batch.isEmpty() || batch.stream().noneMatch(l -> PRE_FILTER.matcher(l).find())) {
      return;
    }
    try {
      classifier
          .classify(promptOverride, String.join("\n", batch))
          .ifPresent(
              classification -> {
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
