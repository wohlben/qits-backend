package eu.wohlben.qits.domain.agent.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;

/**
 * Transcript statistics for one agent session (or one of its subagent sidechains), aggregated by
 * the post-exit transcript sweep — the queryable face of what otherwise lives only inside the
 * imported transcript CLOBs. A null {@link #agentId} marks the session's own row; a non-null one a
 * sidechain the coding agent spawned.
 *
 * <p>Rows are delete-and-reinserted per session on every sweep, so the latest import wins and the
 * table is recomputable from the transcripts at any time.
 */
@Entity
@Table(name = "agent_session_stat")
@Builder
@NoArgsConstructor // Hibernate needs a no-arg constructor; @AllArgsConstructor backs the builder.
@AllArgsConstructor
public class AgentSessionStat extends PanacheEntityBase {

  @Id public String id;

  /** The command whose sweep produced this row (cascade-deleted with it; recomputable anyway). */
  @Column(name = "command_id", nullable = false)
  public String commandId;

  @Column(name = "session_id", nullable = false, length = 36)
  public String sessionId;

  /** Null for the session's own row; the sidechain's agent id for subagent rows. */
  @Column(name = "agent_id")
  public String agentId;

  /** The sidechain's harness agent type from its meta.json (subagent rows only). */
  @Column(name = "agent_type")
  public String agentType;

  /** The sidechain's task description from its meta.json (subagent rows only). */
  @Column(length = 1024)
  public String description;

  /**
   * The number of conversation turns ({@code user} + {@code assistant} lines, excluding tool
   * results and meta lines) — the operator's notion of conversation length.
   */
  @Column(name = "message_count", nullable = false)
  public int messageCount;

  /** The timestamp of the transcript's first line; null when no line carried one. */
  @Column(name = "first_timestamp")
  public Instant firstTimestamp;
}
