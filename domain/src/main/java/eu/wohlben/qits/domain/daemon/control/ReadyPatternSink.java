package eu.wohlben.qits.domain.daemon.control;

import java.util.regex.Pattern;

/** Flips STARTING → READY on the first output line matching the definition's ready pattern. */
final class ReadyPatternSink extends LineFramingSink {

  private final Pattern pattern;
  private final Runnable onReady;
  private boolean fired;

  ReadyPatternSink(Pattern pattern, Runnable onReady) {
    this.pattern = pattern;
    this.onReady = onReady;
  }

  @Override
  protected void onLine(String line) {
    if (!fired && pattern.matcher(line).find()) {
      fired = true;
      onReady.run();
    }
  }
}
