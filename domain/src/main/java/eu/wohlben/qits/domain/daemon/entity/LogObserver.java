package eu.wohlben.qits.domain.daemon.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

/**
 * One log observer attached to a daemon definition: a consumer of the instance's output stream that
 * turns what it sees into {@code ERROR_DETECTED} events. Stored as an element collection on each
 * definition subclass (same split as {@code environment}), so a daemon has an ordered list of
 * observers without an entity of its own.
 */
@Embeddable
public class LogObserver {

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public LogObserverKind kind;

  /** For PATTERN observers: the regex matched against each output line. Unused for MODEL. */
  @Column(length = 500)
  public String pattern;

  /** Severity stamped on PATTERN events; MODEL observers classify severity themselves. */
  @Enumerated(EnumType.STRING)
  public DaemonEventSeverity severity;

  /** For MODEL observers: an optional classifier-prompt override; a good default lives in code. */
  @Column(length = 4000)
  public String prompt;

  public LogObserver() {}

  public LogObserver(
      LogObserverKind kind, String pattern, DaemonEventSeverity severity, String prompt) {
    this.kind = kind;
    this.pattern = pattern;
    this.severity = severity;
    this.prompt = prompt;
  }
}
