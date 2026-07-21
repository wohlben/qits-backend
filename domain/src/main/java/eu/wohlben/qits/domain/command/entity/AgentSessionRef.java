package eu.wohlben.qits.domain.command.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import java.time.Instant;

/**
 * One coding-agent session a command drove, in the order the sessions were entered. The command's
 * current session is the last entry; most commands have exactly one. Lineage falls out of the rows:
 * every command whose list contains a session ID belongs to that session's conversation thread, and
 * {@link #forkedFromSessionId} edges form the fork tree.
 */
@Embeddable
public class AgentSessionRef {

  /** The agent session id — qits-generated and pinned at launch, or hook-reported. */
  @Column(name = "session_id", nullable = false, length = 64)
  public String sessionId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public AgentSessionSource source;

  /** Set on {@link AgentSessionSource#FORKED} entries: the session this one branched from. */
  @Column(name = "forked_from_session_id", length = 64)
  public String forkedFromSessionId;

  /**
   * The transcript JSONL path as reported by the harness's SessionStart hook — a container-side
   * path (authoritative over the computed convention). Null until the hook's first report.
   */
  @Column(name = "transcript_path", length = 1024)
  public String transcriptPath;

  /** When the entry was pinned at launch or reported by the hook. */
  @Column(name = "recorded_at", nullable = false)
  public Instant recordedAt;

  public AgentSessionRef() {}

  public AgentSessionRef(
      String sessionId,
      AgentSessionSource source,
      String forkedFromSessionId,
      String transcriptPath,
      Instant recordedAt) {
    this.sessionId = sessionId;
    this.source = source;
    this.forkedFromSessionId = forkedFromSessionId;
    this.transcriptPath = transcriptPath;
    this.recordedAt = recordedAt;
  }
}
