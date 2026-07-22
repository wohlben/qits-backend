package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.agent.acp.KimiEventNormalizer;
import eu.wohlben.qits.domain.command.control.CommandLogService;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Live counterpart of {@link AgentTranscriptService}'s exit sweep: while a chat runs, polls its
 * main-session transcript JSONL off the shared claude volume and appends each new complete line to
 * {@code command_log_line} on {@link LogChannel#TRANSCRIPT} — so a mid-run re-attach can serve the
 * durable head of the conversation. Main session only; sidechains and stats stay exit-sweep
 * territory, and the exit sweep's delete-and-reimport reconciles whatever the tail did.
 *
 * <p>Poll-based like the daemon file tails (no {@code WatchService}), with a partial line buffered
 * across polls until its newline arrives. Claude lines are imported raw (already the event
 * envelope); Kimi {@code wire.jsonl} lines are run through a per-session {@link
 * KimiEventNormalizer} — the same normalizer + minted uuids the exit sweep uses — so a mid-run
 * re-attach stitches and renders identically to the post-exit reconciliation. The {@code
 * importedLines} high-water counts raw wire lines consumed (what the exit sweep's settle compares
 * against), not emitted envelopes.
 */
@ApplicationScoped
public class AgentTranscriptTailService {

  private static final Logger LOG = Logger.getLogger(AgentTranscriptTailService.class);

  private static final AtomicBoolean MISSING_CONFIG_DIR_LOGGED = new AtomicBoolean();

  @ConfigProperty(name = "qits.agent.transcript-tail-poll-ms", defaultValue = "500")
  long pollMillis;

  @ConfigProperty(name = "qits.agent.type", defaultValue = "claude")
  AgentType agentType;

  @Inject AgentTranscriptService transcriptService;

  @Inject CommandLogService commandLogService;

  private final Map<String, Tail> tails = new ConcurrentHashMap<>();
  private ScheduledExecutorService scheduler;

  @PostConstruct
  void init() {
    scheduler =
        Executors.newScheduledThreadPool(
            2,
            runnable -> {
              Thread thread = new Thread(runnable, "transcript-tail");
              thread.setDaemon(true);
              return thread;
            });
  }

  @PreDestroy
  void shutdown() {
    scheduler.shutdownNow();
  }

  /** Begin polling for the command's main-session transcript (idempotent per command). */
  public void startTail(String commandId) {
    startTail(commandId, transcriptService.configDir());
  }

  /** {@link #startTail(String)}; package-visible so tests can point it at a fixture config dir. */
  void startTail(String commandId, Path configDir) {
    tails.computeIfAbsent(
        commandId,
        id -> {
          Tail tail = new Tail(id, configDir);
          tail.task =
              scheduler.scheduleWithFixedDelay(
                  tail::pollSafely, pollMillis, pollMillis, TimeUnit.MILLISECONDS);
          return tail;
        });
  }

  /**
   * Stop the command's tail: cancel the schedule, run one final synchronous drain (the tail's own
   * lock serializes it against an in-flight poll), and return the high-water count of imported
   * main-session lines — after this no tail write can race the exit sweep's delete-and-reimport.
   */
  public long stopAndDrain(String commandId) {
    Tail tail = tails.remove(commandId);
    if (tail == null) {
      return 0;
    }
    if (tail.task != null) {
      tail.task.cancel(false);
    }
    tail.pollSafely();
    return tail.importedLines;
  }

  /** Run one poll synchronously — deterministic drive for tests. */
  void pollNow(String commandId) {
    Tail tail = tails.get(commandId);
    if (tail != null) {
      tail.pollSafely();
    }
  }

  /** One tracked command's tail: awaiting the file, then byte-position framing across polls. */
  private class Tail {

    private final String commandId;
    private final Path configDir;
    private final ByteArrayOutputStream partialLine = new ByteArrayOutputStream();

    private Future<?> task;
    private Path file;
    private Object fileKey;
    private long bytePosition;
    private long nextSeq = AgentTranscriptService.TRANSCRIPT_SEQ_BASE;
    private volatile long importedLines;

    /** Non-null under Kimi: normalizes each wire.jsonl line into the shared event envelope. */
    private KimiEventNormalizer normalizer;

    private Tail(String commandId, Path configDir) {
      this.commandId = commandId;
      this.configDir = configDir;
    }

    private synchronized void pollSafely() {
      try {
        poll();
      } catch (IOException | RuntimeException e) {
        LOG.debugf(e, "Transcript tail poll failed for command %s", commandId);
      }
    }

    private void poll() throws IOException {
      if (file == null && !locate()) {
        return;
      }
      BasicFileAttributes attributes;
      try {
        attributes = Files.readAttributes(file, BasicFileAttributes.class);
      } catch (NoSuchFileException e) {
        file = null; // vanished (unexpected) — re-locate; a recreated file re-seeds via fileKey.
        return;
      }
      if (fileKey == null) {
        fileKey = attributes.fileKey();
      } else if (!Objects.equals(fileKey, attributes.fileKey())
          || attributes.size() < bytePosition) {
        // The harness only appends, so truncation/replacement is unexpected: re-seed the channel.
        LOG.warnf("Transcript of command %s was truncated or replaced — re-importing", commandId);
        commandLogService.deleteChannel(commandId, LogChannel.TRANSCRIPT);
        bytePosition = 0;
        nextSeq = AgentTranscriptService.TRANSCRIPT_SEQ_BASE;
        importedLines = 0;
        partialLine.reset();
        if (normalizer != null) {
          normalizer.reset(); // re-import from the top must restart the minted indices too.
        }
        fileKey = attributes.fileKey();
      }
      readNewBytes();
    }

    /**
     * Resolve the transcript file — hook-reported path, harness convention, filename lookup — with
     * a fresh session read per attempt (the hook report typically lands moments after launch).
     * Imports from byte 0 deliberately: a resumed session's file already holds prior history.
     */
    private boolean locate() {
      if (!Files.isDirectory(configDir)) {
        if (MISSING_CONFIG_DIR_LOGGED.compareAndSet(false, true)) {
          LOG.warnf(
              "Agent config dir %s does not exist — live transcript import is disabled"
                  + " (is the claude volume mounted?)",
              configDir);
        }
        return false;
      }
      AgentTranscriptService.SessionInfo session = transcriptService.mainSession(commandId);
      if (session == null) {
        return false;
      }
      if (agentType == AgentType.KIMI && normalizer == null) {
        normalizer = new KimiEventNormalizer(session.sessionId());
      }
      file =
          transcriptService.resolveTranscript(
              configDir, CodingAgentFactory.ofType(agentType), session);
      return file != null;
    }

    private void readNewBytes() throws IOException {
      List<CommandLogService.PendingLine> batch = new ArrayList<>();
      try (SeekableByteChannel channel = Files.newByteChannel(file)) {
        channel.position(bytePosition);
        ByteBuffer buffer = ByteBuffer.allocate(8192);
        while (channel.read(buffer) > 0) {
          buffer.flip();
          while (buffer.hasRemaining()) {
            byte b = buffer.get();
            bytePosition++;
            if (b == '\n') {
              completeLine(batch);
            } else {
              partialLine.write(b);
            }
          }
          buffer.clear();
        }
      } catch (NoSuchFileException e) {
        file = null;
      }
      if (!batch.isEmpty()) {
        // A failed import skips these lines until the exit sweep reconciles — best-effort live.
        commandLogService.importLines(List.copyOf(batch));
      }
    }

    private void completeLine(List<CommandLogService.PendingLine> batch) {
      String line = partialLine.toString(StandardCharsets.UTF_8);
      partialLine.reset();
      if (line.endsWith("\r")) {
        line = line.substring(0, line.length() - 1);
      }
      if (line.isBlank()) {
        return; // position already consumed; blank lines carry nothing.
      }
      // High-water counts raw wire lines consumed (incl. Kimi noise the normalizer drops), because
      // that is what the exit sweep's settle compares against the raw file — over-counting on a
      // failed import only makes the sweep wait a little longer, never reimport short.
      importedLines++;
      Instant when =
          transcriptService.lineTimestamp(line) != null
              ? transcriptService.lineTimestamp(line)
              : Instant.now();
      if (normalizer == null) {
        batch.add(
            new CommandLogService.PendingLine(
                commandId, nextSeq++, LogChannel.TRANSCRIPT, line, when));
        return;
      }
      for (String envelope : normalizer.onWireLine(line)) {
        batch.add(
            new CommandLogService.PendingLine(
                commandId, nextSeq++, LogChannel.TRANSCRIPT, envelope, when));
      }
    }
  }
}
