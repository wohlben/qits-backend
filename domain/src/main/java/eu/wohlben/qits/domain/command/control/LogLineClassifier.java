package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.entity.LogSeverity;
import java.util.Optional;

/**
 * Classifies one raw captured log line into a {@link LogSeverity}, or empty for routine output.
 * Defined in the command area so the batch persister can stamp severities without depending on the
 * daemon package; the daemon area's {@code LogLevelClassifier} backs the CDI implementation. Must
 * be cheap and local — it runs per line in the async log-persistence path.
 */
public interface LogLineClassifier {

  Optional<LogSeverity> classify(String rawLine);
}
