package eu.wohlben.qits.domain.agent.control;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import java.util.List;
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

  private static final AtomicBoolean MISSING_CONFIG_DIR_LOGGED = new AtomicBoolean();

  private final ObjectMapper mapper = new ObjectMapper();

  @Inject CommandRepository commandRepository;

  @Inject CommandLogService commandLogService;

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
    for (SessionInfo session : info.sessions()) {
      Path transcript = resolveTranscript(configDir, agent, session);
      if (transcript == null) {
        LOG.warnf(
            "No transcript found for session %s of command %s", session.sessionId(), commandId);
      } else {
        importJsonl(buffer, transcript);
      }
      importSidechains(
          buffer, configDir.resolve(agent.subagentsDir(CONTAINER_CWD, session.sessionId())));
    }
    buffer.flush();
    if (buffer.imported > 0) {
      LOG.infof("Imported %d transcript line(s) for command %s", buffer.imported, commandId);
    }
    changePublisher.fire(info.repoId(), info.workspaceId(), WorkspaceChangeHint.Topic.COMMANDS);
  }

  /** What the sweep needs from the row, copied out of the transaction. */
  private record CommandInfo(String repoId, String workspaceId, List<SessionInfo> sessions) {}

  private record SessionInfo(String sessionId, String reportedTranscriptPath) {}

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
   * upgrades), else null.
   */
  private Path resolveTranscript(Path configDir, CodingAgent agent, SessionInfo session) {
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
  private void importJsonl(ImportBuffer buffer, Path file) {
    try (BufferedReader reader = Files.newBufferedReader(file)) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (!line.isBlank()) {
          buffer.add(line, lineTimestamp(line));
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
   */
  private void importSidechains(ImportBuffer buffer, Path subagentsDir) {
    if (!Files.isDirectory(subagentsDir)) {
      return;
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
    for (Path sidechain : sidechains) {
      String filename = sidechain.getFileName().toString();
      String agentId = filename.substring("agent-".length(), filename.length() - ".jsonl".length());
      buffer.add(agentMetaLine(sidechain, agentId), Instant.now());
      importJsonl(buffer, sidechain);
    }
  }

  private String agentMetaLine(Path sidechain, String agentId) {
    ObjectNode meta = mapper.createObjectNode();
    meta.put("type", AGENT_META_TYPE);
    meta.put("agentId", agentId);
    Path metaFile = sidechain.resolveSibling("agent-" + agentId + ".meta.json");
    if (Files.isRegularFile(metaFile)) {
      try {
        JsonNode parsed = mapper.readTree(metaFile.toFile());
        meta.put("agentType", parsed.path("agentType").asText(null));
        meta.put("description", parsed.path("description").asText(null));
        meta.put("toolUseId", parsed.path("toolUseId").asText(null));
      } catch (IOException e) {
        LOG.debugf(e, "Unreadable sidechain meta %s", metaFile);
      }
    }
    return meta.toString();
  }

  /** The line's own {@code timestamp} field when present and parseable, else now. */
  private Instant lineTimestamp(String line) {
    try {
      JsonNode node = mapper.readTree(line);
      String timestamp = node.path("timestamp").asText(null);
      return timestamp != null ? Instant.parse(timestamp) : Instant.now();
    } catch (IOException | RuntimeException e) {
      return Instant.now();
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
