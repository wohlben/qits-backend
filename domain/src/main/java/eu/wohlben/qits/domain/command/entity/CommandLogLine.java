package eu.wohlben.qits.domain.command.entity;

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
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;

/**
 * One captured line of a command's interaction — the MitM audit log. Lines are high-volume, so this
 * uses a generated surrogate {@code Long} id from a sequence (like {@link
 * eu.wohlben.qits.domain.repository.entity.Worktree}) rather than a UUID. {@code sequence} is a
 * monotonic per-command counter (assigned at capture time across both channels) that gives a stable
 * total order even when two lines share a timestamp.
 */
@Entity
@Table(name = "command_log_line")
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CommandLogLine extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "command_log_line_seq")
  @SequenceGenerator(
      name = "command_log_line_seq",
      sequenceName = "command_log_line_SEQ",
      allocationSize = 50)
  public Long id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "command_id", nullable = false)
  public Command command;

  /** Monotonic per-command ordinal, assigned at capture time; the stable sort key. */
  @Column(name = "seq", nullable = false)
  public long sequence;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public LogChannel channel;

  /** The raw line text, which may contain ANSI escapes; large, so a CLOB. */
  @Lob
  @Column(nullable = false)
  public String content;

  /**
   * Classified severity, stamped at persist time for DAEMON commands' OUTPUT lines; null where the
   * classifier saw nothing (routine output) and for other command kinds. Enables {@code ?severity=}
   * filters without re-parsing.
   */
  @Enumerated(EnumType.STRING)
  public LogSeverity severity;

  /** When the line completed (captured at line-completion time, not at persist time). */
  @Column(name = "at", nullable = false)
  public Instant timestamp;
}
