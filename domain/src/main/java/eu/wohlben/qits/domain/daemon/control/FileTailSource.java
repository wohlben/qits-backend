package eu.wohlben.qits.domain.daemon.control;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.jboss.logging.Logger;

/**
 * Tails one FILE log source of a daemon instance with {@code tail -F} semantics and feeds its
 * observers: start at end-of-file (history is not replayed as events), poll for growth, reopen on
 * rotation (recreated file), truncation (size shrink), or deletion-then-recreation. A missing file
 * is not an error — it is watched until it appears (the daemon usually creates it).
 *
 * <p>The file itself is the durable store — tailed lines are never copied into the database.
 * Observed positions are therefore 1-based line numbers in the current file, valid since the
 * rotation marked by the tail's epoch; on the initial open the pre-existing lines are counted (not
 * replayed) so positions stay real line numbers. Lines are framed on {@code \n} at the byte level,
 * so multi-byte characters split across polls decode correctly.
 */
final class FileTailSource {

  private static final Logger LOG = Logger.getLogger(FileTailSource.class);

  /** A runaway no-newline line is force-framed at this size so the buffer stays bounded. */
  private static final int MAX_LINE_BYTES = 64 * 1024;

  private enum State {
    /**
     * No file right now (missing at start, or vanished mid-tail): when it appears it is a fresh
     * file with no history, read from the top. Only a file that already exists when the tail starts
     * has "history" to skip.
     */
    AWAITING_FILE,
    /** Tailing the current file. */
    TAILING
  }

  private final Path file;
  private final String source;
  private final List<ObservedLineListener> listeners;
  private final ScheduledFuture<?> task;

  private State state = State.AWAITING_FILE;
  private Object fileKey;
  private long bytePosition;
  private long lineNumber;
  private Instant epoch;
  private final ByteArrayOutputStream partial = new ByteArrayOutputStream();
  private volatile boolean closed;

  FileTailSource(
      Path file,
      String source,
      List<ObservedLineListener> listeners,
      ScheduledExecutorService scheduler,
      long pollMillis) {
    this.file = file;
    this.source = source;
    this.listeners = List.copyOf(listeners);
    // A file that exists right now has history to skip; done synchronously so no lines written
    // between construction and the first poll are mistaken for history.
    try {
      openAtEnd(Files.readAttributes(file, BasicFileAttributes.class));
    } catch (IOException e) {
      // Missing (the usual case — the daemon creates it) or unreadable: watch for it.
    }
    this.task =
        scheduler.scheduleWithFixedDelay(this::poll, pollMillis, pollMillis, TimeUnit.MILLISECONDS);
  }

  /** Stops polling after one final drain, so lines written just before an exit still classify. */
  void close() {
    poll();
    closed = true;
    task.cancel(false);
  }

  private synchronized void poll() {
    if (closed) {
      return;
    }
    try {
      BasicFileAttributes attributes = Files.readAttributes(file, BasicFileAttributes.class);
      if (!attributes.isRegularFile()) {
        return;
      }
      switch (state) {
        case AWAITING_FILE -> {
          openAtStart(attributes);
          readNewBytes();
        }
        case TAILING -> {
          boolean recreated = fileKey != null && !fileKey.equals(attributes.fileKey());
          if (recreated || attributes.size() < bytePosition) {
            openAtStart(attributes);
          }
          readNewBytes();
        }
      }
    } catch (NoSuchFileException e) {
      if (state == State.TAILING) {
        state = State.AWAITING_FILE;
        partial.reset();
      }
    } catch (IOException e) {
      LOG.debugf(e, "Tail poll failed for %s", file);
    }
  }

  /** Pre-existing file at tail start: count its lines (no replay) and continue from the end. */
  private void openAtEnd(BasicFileAttributes attributes) throws IOException {
    long size = attributes.size();
    long lines = 0;
    try (InputStream in = Files.newInputStream(file)) {
      byte[] buffer = new byte[8192];
      long remaining = size;
      int read;
      while (remaining > 0
          && (read = in.read(buffer, 0, (int) Math.min(buffer.length, remaining))) != -1) {
        for (int i = 0; i < read; i++) {
          if (buffer[i] == '\n') {
            lines++;
          }
        }
        remaining -= read;
      }
    }
    fileKey = attributes.fileKey();
    bytePosition = size;
    lineNumber = lines;
    epoch = Instant.now();
    partial.reset();
    state = State.TAILING;
  }

  /** Rotation/truncation/recreation: a fresh file, read from the top under a new epoch. */
  private void openAtStart(BasicFileAttributes attributes) {
    fileKey = attributes.fileKey();
    bytePosition = 0;
    lineNumber = 0;
    epoch = Instant.now();
    partial.reset();
    state = State.TAILING;
  }

  private void readNewBytes() throws IOException {
    try (InputStream in = Files.newInputStream(file)) {
      long skipped = in.skip(bytePosition);
      if (skipped < bytePosition) {
        return; // shrank between stat and read; the next poll sees the truncation
      }
      byte[] buffer = new byte[8192];
      int read;
      while ((read = in.read(buffer)) != -1) {
        for (int i = 0; i < read; i++) {
          byte b = buffer[i];
          if (b == '\n') {
            completeLine();
          } else {
            partial.write(b);
            if (partial.size() >= MAX_LINE_BYTES) {
              completeLine();
            }
          }
        }
        bytePosition += read;
      }
    }
  }

  private void completeLine() {
    String line = partial.toString(StandardCharsets.UTF_8);
    partial.reset();
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length() - 1);
    }
    long position = ++lineNumber;
    line = LineFramingSink.stripAnsi(line);
    if (line.isBlank()) {
      return; // the position is still consumed, so anchors stay true line numbers
    }
    ObservedLine observed = new ObservedLine(source, position, epoch, line);
    for (ObservedLineListener listener : listeners) {
      try {
        listener.onLine(observed);
      } catch (RuntimeException e) {
        LOG.warnf(e, "Observer failed on a tailed line from %s", source);
      }
    }
  }
}
