package eu.wohlben.qits.domain.repository.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;

/**
 * A worktree, soft-deleted: cleanup/discard removes the on-disk worktree and branch but keeps this
 * row as the persistent record of the unit of work — its {@link #status}, the markdown {@link
 * #preamble} (why it was created) and {@link #result} (how it ended), and (via the {@code
 * Command.worktree} FK) the commands that ran in it. Its {@link WorktreeEvent} timeline records
 * what happened. There is no DB unique constraint on {@code (repository, worktreeId)} — resolved
 * rows accumulate; the service enforces at most one {@code ACTIVE} worktree per id.
 */
@Entity
@Table(name = "worktree")
public class Worktree extends PanacheEntityBase {

  @Id @GeneratedValue public Long id;

  @Column(name = "worktree_id", nullable = false)
  public String worktreeId;

  @ManyToOne(optional = false)
  @JoinColumn(name = "repository_id", nullable = false)
  public Repository repository;

  @Column(name = "parent_id")
  public String parent;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public WorktreeStatus status = WorktreeStatus.ACTIVE;

  /** Markdown: the reason/goal, authored at creation, editable while ACTIVE. */
  @Lob public String preamble;

  /** Markdown: the outcome, authored at integration or abandonment. */
  @Lob public String result;

  /** When the worktree was resolved (integrated/abandoned); null while ACTIVE. */
  @Column(name = "resolved_at")
  public Instant resolvedAt;

  /** When the row was created; null for rows that predate this column. */
  @CreationTimestamp
  @Column(name = "created_at", updatable = false)
  public Instant createdAt;
}
