package eu.wohlben.qits.domain.agent.control;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.wohlben.qits.domain.agent.entity.AgentSessionStat;
import eu.wohlben.qits.domain.agent.persistence.AgentSessionStatRepository;
import eu.wohlben.qits.domain.command.control.CommandLogService;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.workspace.control.WorkspaceChangeHint;
import eu.wohlben.qits.domain.workspace.control.WorkspaceChangePublisher;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Imports agent-session transcripts — the JSONL files the harness itself persists, including
 * subagent sidechains — into {@code command_log_line} on the {@link LogChannel#TRANSCRIPT} channel.
 * This makes qits the durable owner of the conversation: the harness prunes old sessions and the
 * shared claude volume is disposable, while the DB copy survives both.
 *
 * <p>Runs once per agent command, on process exit (composed onto the registry exit listener), as a
 * delete-and-reimport of the command's {@code TRANSCRIPT} channel — idempotent by construction. A
 * command that traversed several sessions (in-TUI {@code /resume}) imports each session's
 * transcript in list order; the lines self-describe via {@code sessionId}, so segment boundaries
 * stay recoverable in the rendered view.
 *
 * <p>The transcript location is harness-owned ({@link CodingAgent#transcriptPath}): qits reads it
 * directly off its own filesystem because the devcontainer mounts the same claude volume the
 * workspace containers write to ({@code qits.agent.claude-config-dir}).
 */
@ApplicationScoped
public class AgentTranscriptService {

  private static final Logger LOG = Logger.getLogger(AgentTranscriptService.class);

  /** Every workspace container runs the agent with this cwd (the clone mount point). */
  static final String CONTAINER_CWD = "/workspace";

  /**
   * Base of the TRANSCRIPT sequence space, disjoint from live stdio sequences (which start at 0 per
   * run) so imported lines sort after — and never collide with — intercepted output.
   */
  static final long TRANSCRIPT_SEQ_BASE = 1L << 40;

  /** The synthetic line type carrying a sidechain's meta (agent type, description, anchor). */
  static final String AGENT_META_TYPE = "qits_agent_meta";

  /** How often and how long {@link #onChatExit} waits for the harness's JSONL flush. */
  private static final int SETTLE_ATTEMPTS = 4;

  private static final long SETTLE_DELAY_MS = 250;

  private static final AtomicBoolean MISSING_CONFIG_DIR_LOGGED = new AtomicBoolean();

  private final ObjectMapper mapper = new ObjectMapper();

  @Inject CommandRepository commandRepository;

  @Inject CommandLogService commandLogService;

  @Inject AgentSessionStatRepository statRepository;

  @Inject WorkspaceChangePublisher changePublisher;

  /**
   * The harness config dir on qits' own filesystem — the shared claude volume's mount plus the
   * harness dot-dir. Transcripts live beneath it ({@code projects/<escaped-cwd>/…}).
   */
  @ConfigProperty(
      name = "qits.agent.claude-config-dir",
      defaultValue = "${qits.workspace.claude-mount:/claude-home}/.claude")
  String claudeConfigDir;

  /**
   * Where the claude volume mounts in the <em>containers</em> (hook-reported transcript paths are
   * container-side); used to remap them onto {@link #claudeConfigDir}.
   */
  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  /**
   * The exit-listener entry point: sweep the command's transcripts, never letting a failure
   * propagate into the registry's exit handling.
   */
  public void onCommandExit(String commandId) {
    try {
      sweep(commandId, Path.of(claudeConfigDir));
    } catch (RuntimeException e) {
      LOG.errorf(e, "Transcript sweep failed for command %s", commandId);
    }
  }

  /**
   * The chat variant of {@link #onCommandExit}: the live tail has already imported {@code
   * expectedMainLines} main-session lines, so wait for the harness's asynchronous JSONL flush to
   * catch up before the delete-and-reimport — sweeping early would replace the tail's good rows
   * with fewer. Bounded settle (the exit chain runs on the chat reader thread and {@code
   * terminate()} waits only 2 s on the finish latch); on exhaustion, sweep anyway with a warning.
   */
  public void onChatExit(String commandId, long expectedMainLines) {
    try {
      chatSweep(commandId, expectedMainLines, Path.of(claudeConfigDir));
    } catch (RuntimeException e) {
      LOG.errorf(e, "Transcript sweep failed for command %s", commandId);
    }
  }

  /** Settle-then-sweep; package-visible so tests can point it at a fixture config dir. */
  void chatSweep(String commandId, long expectedMainLines, Path configDir) {
    awaitSettled(commandId, expectedMainLines, configDir);
    sweep(commandId, configDir);
  }

  private void awaitSettled(String commandId, long expectedMainLines, Path configDir) {
    if (expectedMainLines <= 0 || !Files.isDirectory(configDir)) {
      return;
    }
    SessionInfo main = mainSession(commandId);
    if (main == null) {
      return;
    }
    CodingAgent agent = CodingAgentFactory.ofType(AgentType.CLAUDE);
    for (int attempt = 0; ; attempt++) {
      Path transcript = resolveTranscript(configDir, agent, main);
      if (transcript != null && countNonBlankLines(transcript) >= expectedMainLines) {
        return;
      }
      if (attempt >= SETTLE_ATTEMPTS - 1) {
        LOG.warnf(
            "Transcript of command %s is still shorter than the %d line(s) already imported"
                + " live — sweeping anyway",
            commandId, expectedMainLines);
        return;
      }
      try {
        Thread.sleep(SETTLE_DELAY_MS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      }
    }
  }

  private long countNonBlankLines(Path file) {
    try (Stream<String> lines = Files.lines(file)) {
      return lines.filter(line -> !line.isBlank()).count();
    } catch (IOException e) {
      return -1;
    }
  }

  /** The command's first (for a chat: only) session, or null — read in its own transaction. */
  SessionInfo mainSession(String commandId) {
    return QuarkusTransaction.requiringNew()
        .call(
            () -> {
              Command command = commandRepository.findById(commandId);
              if (command == null || command.agentSessions.isEmpty()) {
                return null;
              }
              var ref = command.agentSessions.get(0);
              return new SessionInfo(ref.sessionId, ref.transcriptPath);
            });
  }

  /** The line's own {@code timestamp} field when present and parseable, else null. */
  Instant lineTimestamp(String line) {
    return ownTimestamp(parseLine(line));
  }

  /** The sweep itself; package-visible so tests can point it at a fixture config dir. */
  void sweep(String commandId, Path configDir) {
    CommandInfo info = loadInfo(commandId);
    if (info == null || info.sessions().isEmpty()) {
      return; // not an agent command (or gone) — nothing to import.
    }
    if (!Files.isDirectory(configDir)) {
      // qits is running without the shared claude volume; say so once, not per command.
      if (MISSING_CONFIG_DIR_LOGGED.compareAndSet(false, true)) {
        LOG.warnf(
            "Agent config dir %s does not exist — transcript import is disabled"
                + " (is the claude volume mounted?)",
            configDir);
      }
      return;
    }

    // Delete-and-reimport: a crashed prior sweep or a manual re-trigger converges to one copy.
    commandLogService.deleteChannel(commandId, LogChannel.TRANSCRIPT);

    ImportBuffer buffer = new ImportBuffer(commandId);
    CodingAgent agent = CodingAgentFactory.ofType(AgentType.CLAUDE);
    // Stats aggregate once per session even when the list revisits one (in-TUI switch back).
    Set<String> visited = new LinkedHashSet<>();
    List<AgentSessionStat> stats = new ArrayList<>();
    for (SessionInfo session : info.sessions()) {
      boolean firstVisit = visited.add(session.sessionId());
      Path transcript = resolveTranscript(configDir, agent, session);
      StatCollector sessionStat = new StatCollector();
      if (transcript == null) {
        LOG.warnf(
            "No transcript found for session %s of command %s", session.sessionId(), commandId);
      } else {
        importJsonl(buffer, transcript, sessionStat);
        if (firstVisit) {
          stats.add(sessionStat.toStat(commandId, session.sessionId(), null, null));
        }
      }
      List<AgentSessionStat> sidechainStats =
          importSidechains(
              buffer,
              configDir.resolve(agent.subagentsDir(CONTAINER_CWD, session.sessionId())),
              commandId,
              session.sessionId());
      if (firstVisit) {
        stats.addAll(sidechainStats);
      }
    }
    buffer.flush();
    replaceStats(stats);
    if (buffer.imported > 0) {
      LOG.infof("Imported %d transcript line(s) for command %s", buffer.imported, commandId);
    }
    changePublisher.fire(info.repoId(), info.workspaceId(), WorkspaceChangeHint.Topic.COMMANDS);
  }

  /** What the sweep needs from the row, copied out of the transaction. */
  private record CommandInfo(String repoId, String workspaceId, List<SessionInfo> sessions) {}

  /** One session's identity + hook-reported path; shared with the live tail. */
  record SessionInfo(String sessionId, String reportedTranscriptPath) {}

  /** Read in its own transaction — exit listeners run on registry reader threads. */
  private CommandInfo loadInfo(String commandId) {
    return QuarkusTransaction.requiringNew()
        .call(
            () -> {
              Command command = commandRepository.findById(commandId);
              if (command == null) {
                return null;
              }
              List<SessionInfo> sessions =
                  command.agentSessions.stream()
                      .map(ref -> new SessionInfo(ref.sessionId, ref.transcriptPath))
                      .toList();
              return new CommandInfo(
                  command.workspace.repository.id, command.workspace.workspaceId, sessions);
            });
  }

  /**
   * The session's transcript file: the hook-reported path (authoritative, remapped from the
   * container mount) when it resolves, else the harness convention, else an exact-filename lookup
   * under {@code projects/} (the recovery path if the escaping convention ever drifts across CLI
   * upgrades), else null. Package-visible: the live tail resolves the same way.
   */
  Path resolveTranscript(Path configDir, CodingAgent agent, SessionInfo session) {
    Path reported = remapReportedPath(configDir, session.reportedTranscriptPath());
    if (reported != null && Files.isRegularFile(reported)) {
      return reported;
    }
    Path conventional = configDir.resolve(agent.transcriptPath(CONTAINER_CWD, session.sessionId()));
    if (Files.isRegularFile(conventional)) {
      return conventional;
    }
    return findByFilename(configDir.resolve("projects"), session.sessionId() + ".jsonl");
  }

  /**
   * Hook-reported paths are container-side ({@code <claude-mount>/.claude/…}); strip that prefix
   * and resolve the remainder against qits' own config dir. In the devcontainer both are {@code
   * /claude-home/.claude}, so this is a no-op there.
   */
  private Path remapReportedPath(Path configDir, String reportedPath) {
    if (reportedPath == null || reportedPath.isBlank()) {
      return null;
    }
    String containerConfigDir = claudeMount + "/.claude/";
    if (reportedPath.startsWith(containerConfigDir)) {
      return configDir.resolve(reportedPath.substring(containerConfigDir.length()));
    }
    return null; // an unexpected location — fall back to the convention.
  }

  private Path findByFilename(Path projectsDir, String filename) {
    if (!Files.isDirectory(projectsDir)) {
      return null;
    }
    // projects/<escaped-cwd>/<sessionId>.jsonl — depth 2; one spare level for safety.
    try (Stream<Path> walk = Files.walk(projectsDir, 3)) {
      return walk.filter(p -> p.getFileName().toString().equals(filename))
          .filter(Files::isRegularFile)
          .findFirst()
          .orElse(null);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** Streams one JSONL file into the buffer (no slurp — transcripts can be large). */
  private void importJsonl(ImportBuffer buffer, Path file, StatCollector stats) {
    try (BufferedReader reader = Files.newBufferedReader(file)) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (!line.isBlank()) {
          JsonNode node = parseLine(line);
          Instant timestamp = ownTimestamp(node);
          buffer.add(line, timestamp != null ? timestamp : Instant.now());
          stats.observe(node, timestamp);
        }
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * Imports every sidechain of a session: for each {@code agent-<id>.jsonl} (sorted by name for
   * determinism) a synthetic {@value #AGENT_META_TYPE} line built from the sibling {@code
   * .meta.json} precedes the sidechain's lines, giving the renderer the group label ({@code
   * agentType: description}) and the {@code toolUseId} anchoring it to the spawning Task call.
   * Returns one stat row per sidechain, labeled from the same meta.
   */
  private List<AgentSessionStat> importSidechains(
      ImportBuffer buffer, Path subagentsDir, String commandId, String sessionId) {
    if (!Files.isDirectory(subagentsDir)) {
      return List.of();
    }
    List<Path> sidechains;
    try (Stream<Path> list = Files.list(subagentsDir)) {
      sidechains =
          list.filter(p -> p.getFileName().toString().matches("agent-.*\\.jsonl"))
              .sorted()
              .toList();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    List<AgentSessionStat> stats = new ArrayList<>();
    for (Path sidechain : sidechains) {
      String filename = sidechain.getFileName().toString();
      String agentId = filename.substring("agent-".length(), filename.length() - ".jsonl".length());
      SidechainMeta meta = readSidechainMeta(sidechain, agentId);
      buffer.add(agentMetaLine(agentId, meta), Instant.now());
      StatCollector collector = new StatCollector();
      importJsonl(buffer, sidechain, collector);
      stats.add(collector.toStat(commandId, sessionId, agentId, meta));
    }
    return stats;
  }

  /** The sidechain's {@code agentType}/{@code description}/{@code toolUseId} labels. */
  private record SidechainMeta(String agentType, String description, String toolUseId) {}

  private SidechainMeta readSidechainMeta(Path sidechain, String agentId) {
    Path metaFile = sidechain.resolveSibling("agent-" + agentId + ".meta.json");
    if (Files.isRegularFile(metaFile)) {
      try {
        JsonNode parsed = mapper.readTree(metaFile.toFile());
        // The labels are agent-produced free text; clamp them to the stat columns' widths.
        return new SidechainMeta(
            truncate(parsed.path("agentType").asText(null), 255),
            truncate(parsed.path("description").asText(null), 1024),
            parsed.path("toolUseId").asText(null));
      } catch (IOException e) {
        LOG.debugf(e, "Unreadable sidechain meta %s", metaFile);
      }
    }
    return new SidechainMeta(null, null, null);
  }

  private static String truncate(String value, int maxLength) {
    return value != null && value.length() > maxLength ? value.substring(0, maxLength) : value;
  }

  private String agentMetaLine(String agentId, SidechainMeta meta) {
    ObjectNode node = mapper.createObjectNode();
    node.put("type", AGENT_META_TYPE);
    node.put("agentId", agentId);
    if (meta.agentType() != null) {
      node.put("agentType", meta.agentType());
    }
    if (meta.description() != null) {
      node.put("description", meta.description());
    }
    if (meta.toolUseId() != null) {
      node.put("toolUseId", meta.toolUseId());
    }
    return node.toString();
  }

  private JsonNode parseLine(String line) {
    try {
      return mapper.readTree(line);
    } catch (IOException | RuntimeException e) {
      return null;
    }
  }

  /** The line's own {@code timestamp} field when present and parseable, else null. */
  private Instant ownTimestamp(JsonNode node) {
    if (node == null) {
      return null;
    }
    try {
      String timestamp = node.path("timestamp").asText(null);
      return timestamp != null ? Instant.parse(timestamp) : null;
    } catch (RuntimeException e) {
      return null;
    }
  }

  /**
   * Whether a transcript line is a conversation turn the operator would count — a {@code user} or
   * {@code assistant} message actually carrying text, not a tool-result/tool-call carrier, a
   * thinking-only line, or a meta line.
   */
  private static boolean isConversationTurn(JsonNode node) {
    if (node == null) {
      return false;
    }
    String type = node.path("type").asText("");
    if (!"user".equals(type) && !"assistant".equals(type)) {
      return false;
    }
    if (node.path("isMeta").asBoolean(false)) {
      return false;
    }
    JsonNode content = node.path("message").path("content");
    if (content.isTextual()) {
      return !content.asText().isBlank();
    }
    for (JsonNode block : content) {
      if ("text".equals(block.path("type").asText(""))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Replaces the swept sessions' stat rows with this import's aggregation, in its own transaction
   * (exit listeners run on registry reader threads). Keyed by session, not command: a later resume
   * of the same session supersedes the earlier import's counts instead of duplicating them, and a
   * sweep that found no transcript leaves an earlier import's stats in place.
   */
  private void replaceStats(List<AgentSessionStat> stats) {
    if (stats.isEmpty()) {
      return;
    }
    Set<String> sessionIds = new LinkedHashSet<>();
    for (AgentSessionStat stat : stats) {
      sessionIds.add(stat.sessionId);
    }
    QuarkusTransaction.requiringNew()
        .run(
            () -> {
              statRepository.deleteBySessionIds(sessionIds);
              statRepository.persist(stats);
            });
  }

  /** Aggregates one transcript's stat row while its lines stream through the import. */
  private static class StatCollector {
    private int messageCount;
    private Instant firstTimestamp;

    private void observe(JsonNode node, Instant timestamp) {
      if (firstTimestamp == null && timestamp != null) {
        firstTimestamp = timestamp;
      }
      if (isConversationTurn(node)) {
        messageCount++;
      }
    }

    private AgentSessionStat toStat(
        String commandId, String sessionId, String agentId, SidechainMeta meta) {
      return AgentSessionStat.builder()
          .id(UUID.randomUUID().toString())
          .commandId(commandId)
          .sessionId(sessionId)
          .agentId(agentId)
          .agentType(meta == null ? null : meta.agentType())
          .description(meta == null ? null : meta.description())
          .messageCount(messageCount)
          .firstTimestamp(firstTimestamp)
          .build();
    }
  }

  /** Accumulates lines and flushes them in batches through the synchronous import path. */
  private class ImportBuffer {
    private static final int FLUSH_AT = 256;

    private final String commandId;
    private final List<CommandLogService.PendingLine> pending = new ArrayList<>(FLUSH_AT);
    private long seq = TRANSCRIPT_SEQ_BASE;
    private long imported;

    private ImportBuffer(String commandId) {
      this.commandId = commandId;
    }

    private void add(String content, Instant timestamp) {
      pending.add(
          new CommandLogService.PendingLine(
              commandId, seq++, LogChannel.TRANSCRIPT, content, timestamp));
      imported++;
      if (pending.size() >= FLUSH_AT) {
        flush();
      }
    }

    private void flush() {
      if (!pending.isEmpty()) {
        commandLogService.importLines(List.copyOf(pending));
        pending.clear();
      }
    }
  }
}
