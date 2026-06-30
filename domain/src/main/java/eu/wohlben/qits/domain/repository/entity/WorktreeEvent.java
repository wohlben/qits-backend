package eu.wohlben.qits.domain.repository.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;

/**
 * One entry in a worktree's history timeline — what happened and when, with the
 * branch/parent/target/ commit context snapshotted as strings. High-volume, so a sequence-generated
 * {@code Long} id (like {@code CommandLogLine}).
 */
@Entity
@Table(name = "worktree_event")
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WorktreeEvent extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "worktree_event_seq")
  @SequenceGenerator(
      name = "worktree_event_seq",
      sequenceName = "worktree_event_SEQ",
      allocationSize = 50)
  public Long id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "worktree_id_fk", nullable = false)
  public Worktree worktree;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public WorktreeEventType type;

  public String branch;
  public String parent;
  public String target;

  @Column(name = "commit_hash")
  public String commit;

  @Column(length = 2000)
  public String note;

  @Column(name = "at", nullable = false)
  public Instant at;
}
