package eu.wohlben.qits.domain.agent.control;

import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Runs a one-off subprocess to completion with a hard timeout, capturing stdout and stderr
 * separately. Unlike {@code GitExecutor} the streams are never merged — callers such as prompt
 * refinement treat stdout as the payload, so stderr noise must not leak into it. Injectable so
 * tests can substitute a fake.
 */
@ApplicationScoped
public class ProcessExecutor {

  /** The outcome of a finished (or forcibly terminated) invocation. */
  public record Result(int exitCode, String stdout, String stderr, boolean timedOut) {}

  public Result exec(List<String> command, Path cwd, Map<String, String> env, Duration timeout) {
    ProcessBuilder builder = new ProcessBuilder(command).directory(cwd.toFile());
    builder.environment().putAll(env);
    try {
      Process process = builder.start();
      // Drain both pipes concurrently so neither can fill its buffer and deadlock the child.
      var stdout = readAsync(process, true);
      var stderr = readAsync(process, false);
      boolean finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
      if (!finished) {
        process.destroyForcibly();
        process.waitFor();
      }
      return new Result(process.exitValue(), stdout.join(), stderr.join(), !finished);
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to start process: " + command, e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while waiting for process: " + command, e);
    }
  }

  private java.util.concurrent.CompletableFuture<String> readAsync(Process process, boolean out) {
    return java.util.concurrent.CompletableFuture.supplyAsync(
        () -> {
          try (var stream = out ? process.getInputStream() : process.getErrorStream()) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
          } catch (IOException e) {
            throw new UncheckedIOException(e);
          }
        },
        runnable -> Thread.ofVirtual().start(runnable));
  }
}
