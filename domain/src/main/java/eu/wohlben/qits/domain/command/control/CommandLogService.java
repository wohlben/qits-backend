package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.CommandLogLine;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.command.entity.LogSeverity;
import eu.wohlben.qits.domain.command.mapper.CommandLogLineMapper;
import eu.wohlben.qits.domain.command.persistence.CommandLogLineRepository;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.jboss.logging.Logger;

/**
 * Captures command log lines and persists them off the hot path. The registry's session calls
 * {@link #append} from its reader/stdin threads (cheap enqueue); a single background writer thread
 * drains the queue in batches and persists each batch in one transaction (via {@link
 * CommandLogBatchPersister}). Batching keeps a chatty command (e.g. {@code mvn test} emitting
 * thousands of lines) from doing a DB round-trip per line. Best-effort: a hard crash may drop the
 * last unflushed batch.
 */
@ApplicationScoped
public class CommandLogService implements CommandLogWriter, CommandLogReader {

  private static final Logger LOG = Logger.getLogger(CommandLogService.class);

  /** Max lines persisted in a single transaction. */
  private static final int BATCH_MAX = 256;

  /** One captured line awaiting persistence. */
  public record PendingLine(
      String commandId, long sequence, LogChannel channel, String content, Instant timestamp) {}

  private final BlockingQueue<PendingLine> queue = new LinkedBlockingQueue<>();

  private volatile boolean running = true;
  private Thread writer;

  @Inject CommandLogBatchPersister persister;

  @Inject CommandLogLineRepository commandLogLineRepository;

  @Inject CommandLogLineMapper commandLogLineMapper;

  void onStart(@Observes StartupEvent event) {
    writer = new Thread(this::drainLoop, "command-log-writer");
    writer.setDaemon(true);
    writer.start();
  }

  void onStop(@Observes ShutdownEvent event) {
    running = false;
    if (writer != null) {
      writer.interrupt();
      try {
        writer.join(TimeUnit.SECONDS.toMillis(5));
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
  }

  @Override
  public void append(
      String commandId, long sequence, LogChannel channel, String content, Instant timestamp) {
    queue.offer(new PendingLine(commandId, sequence, channel, content, timestamp));
  }

  private void drainLoop() {
    List<PendingLine> batch = new ArrayList<>(BATCH_MAX);
    while (running || !queue.isEmpty()) {
      try {
        PendingLine first = queue.poll(500, TimeUnit.MILLISECONDS);
        if (first == null) {
          continue;
        }
        batch.clear();
        batch.add(first);
        queue.drainTo(batch, BATCH_MAX - 1);
        persister.persist(batch);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        if (!running) {
          break;
        }
      } catch (RuntimeException e) {
        LOG.error("Failed to persist a command-log batch; dropping it", e);
      }
    }
  }

  /** The already-flushed head of a command's log, for full-transcript restore on re-attach. */
  @Override
  @Transactional
  public List<String> linesBefore(String commandId, long sequenceExclusive) {
    return commandLogLineRepository
        .findByCommandAndSeqLessThanOrderBySeq(commandId, sequenceExclusive)
        .stream()
        .map(line -> line.content)
        .toList();
  }

  /** A command's captured log in order; a non-null {@code severity} narrows to those lines. */
  @Transactional
  public List<CommandLogLineDto> log(String commandId, LogSeverity severity) {
    return log(commandId, severity, null);
  }

  /**
   * A command's captured log in order; non-null {@code severity}/{@code channel} narrow to those
   * lines (channel separates intercepted stdio from the imported agent transcript).
   */
  @Transactional
  public List<CommandLogLineDto> log(String commandId, LogSeverity severity, LogChannel channel) {
    List<CommandLogLine> lines;
    if (channel != null) {
      lines = commandLogLineRepository.findByCommandAndChannelOrderBySeq(commandId, channel);
      if (severity != null) {
        lines = lines.stream().filter(line -> line.severity == severity).toList();
      }
    } else if (severity != null) {
      lines = commandLogLineRepository.findByCommandAndSeverityOrderBySeq(commandId, severity);
    } else {
      lines = commandLogLineRepository.findByCommandOrderBySeq(commandId);
    }
    return lines.stream().map(commandLogLineMapper::toDto).toList();
  }

  /**
   * Persist imported lines synchronously, bypassing the async queue — the transcript sweep needs
   * deterministic completion (it deletes and reimports the {@code TRANSCRIPT} channel), so its
   * lines must not interleave with a queue drain.
   */
  public void importLines(List<PendingLine> lines) {
    for (int from = 0; from < lines.size(); from += BATCH_MAX) {
      persister.persist(lines.subList(from, Math.min(from + BATCH_MAX, lines.size())));
    }
  }

  /** Delete a command's lines on one channel (the sweep's delete-and-reimport idempotency). */
  @Transactional
  public long deleteChannel(String commandId, LogChannel channel) {
    return commandLogLineRepository.deleteByCommandAndChannel(commandId, channel);
  }
}
