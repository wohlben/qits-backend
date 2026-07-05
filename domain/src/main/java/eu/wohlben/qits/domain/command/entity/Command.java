package eu.wohlben.qits.domain.command.entity;

import eu.wohlben.qits.domain.repository.entity.Workspace;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * A launched process tracked by the {@code CommandRegistry}, persisted so the "Commands" UX can
 * show what is currently active and where it came from — and so a terminated run survives a
 * restart.
 *
 * <p>The only real foreign key is to {@link Workspace} (the repository is reachable via {@code
 * workspace.repository}); the branch and the commit hash that was checked out at launch are
 * captured as plain string snapshots, because branches and commits are not entities in this
 * codebase. The resolved action is likewise snapshotted by id/name/script rather than FK'd, since
 * an action can be global or repository-owned (no single entity type) and may be edited or deleted
 * after the run.
 */
@Entity
@Table(name = "command")
@Builder
@NoArgsConstructor // Hibernate needs a no-arg constructor; @AllArgsConstructor backs the builder.
@AllArgsConstructor
public class Command extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "workspace_id_fk", nullable = false)
  public Workspace workspace;

  /** The branch checked out in the workspace at launch (a snapshot; branches aren't entities). */
  @Column(nullable = false)
  public String branch;

  /** The commit SHA checked out at launch (a snapshot; commits aren't entities). */
  @Column(name = "commit_hash", nullable = false)
  public String commitHash;

  /**
   * The resolved action's id (global or repository-owned — snapshotted, not FK'd). Null for
   * launches that aren't backed by an action, e.g. a coding-agent session started via the agent
   * path.
   */
  @Column(name = "action_id")
  public String actionId;

  @Column(name = "action_name", nullable = false)
  public String actionName;

  /**
   * The exact shell line that was run. Stored as a large object because an agent launch embeds its
   * prompt directly in the command, which can be long.
   */
  @Lob
  @Column(name = "execute_script", nullable = false)
  public String executeScript;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public CommandStatus status;

  /** How the process is driven and rendered — a PTY terminal or a stream-json chat. */
  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  @Builder.Default
  public CommandKind kind = CommandKind.TERMINAL;

  /** The process exit code, once it has finished; null while running. */
  @Column(name = "exit_code")
  public Integer exitCode;

  /** Whether the action was interactive (a human attaches a terminal) — snapshot of the action. */
  @Column(nullable = false)
  public boolean interactive;

  @CreationTimestamp
  @Column(name = "launched_at", nullable = false, updatable = false)
  public Instant launchedAt;

  @Column(name = "finished_at")
  public Instant finishedAt;
}
