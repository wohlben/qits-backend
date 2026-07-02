package eu.wohlben.qits.domain.speech.control;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * The resident Parakeet transcription process. Loading the model costs seconds, so instead of a
 * python run per request, one worker (see {@code speech/transcribe_worker.py}) stays alive with the
 * model in memory and requests stream over its pipes: one WAV path in, one JSON line out. That
 * makes per-utterance latency inference-only — what live-ish transcription needs.
 *
 * <p>Requests are serialized (the worker is single-threaded anyway); a dead or wedged worker is
 * killed and respawned once per request before giving up.
 */
@ApplicationScoped
public class SpeechWorker {

  private static final Logger LOG = Logger.getLogger(SpeechWorker.class);

  /** Covers a cold model download from the Hugging Face hub on first-ever start. */
  private static final Duration START_TIMEOUT = Duration.ofMinutes(10);

  private static final Duration TRANSCRIBE_TIMEOUT = Duration.ofMinutes(2);

  private final ObjectMapper mapper = new ObjectMapper();

  @ConfigProperty(name = "qits.speech.home", defaultValue = "data/speech")
  String speechHome;

  private Process process;
  private BufferedWriter stdin;
  private BufferedReader stdout;

  /** Transcribes one staged WAV. The venv must already exist (TranscriptionService.ensureReady). */
  public synchronized String transcribe(Path wav) {
    ensureProcess();
    try {
      return request(wav);
    } catch (IOException | TimeoutException e) {
      LOG.warnf(e, "Speech worker failed — respawning and retrying once.");
      stop();
      ensureProcess();
      try {
        return request(wav);
      } catch (IOException | TimeoutException retry) {
        stop();
        throw new InternalServerErrorException(
            "Transcription worker failed: " + retry.getMessage());
      }
    }
  }

  /** Spawns the worker (and thereby loads/caches the model) if it isn't running. */
  public synchronized void ensureProcess() {
    if (process != null && process.isAlive()) {
      return;
    }
    Path home = Path.of(speechHome).toAbsolutePath();
    Path python = home.resolve("venv").resolve("bin").resolve("python");
    Path script = home.resolve("transcribe_worker.py");
    LOG.infof("Starting speech worker (%s)…", script);
    try {
      ProcessBuilder builder = new ProcessBuilder(python.toString(), script.toString());
      builder.directory(home.toFile());
      process = builder.start();
      stdin =
          new BufferedWriter(
              new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
      stdout =
          new BufferedReader(
              new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
      drainStderr(process);
      JsonNode ready = mapper.readTree(readLine(START_TIMEOUT));
      if (!ready.path("ready").asBoolean(false)) {
        throw new IOException("unexpected worker greeting: " + ready);
      }
      LOG.info("Speech worker ready (parakeet model loaded).");
    } catch (IOException | TimeoutException e) {
      stop();
      throw new InternalServerErrorException(
          "Failed to start the transcription worker: " + e.getMessage());
    }
  }

  private String request(Path wav) throws IOException, TimeoutException {
    stdin.write(wav.toString());
    stdin.newLine();
    stdin.flush();
    JsonNode response = mapper.readTree(readLine(TRANSCRIBE_TIMEOUT));
    if (response.hasNonNull("error")) {
      // The worker survived but the input was bad — no respawn needed, just report it.
      throw new InternalServerErrorException(
          "Transcription failed: " + response.get("error").asText());
    }
    return response.path("text").asText().strip();
  }

  /**
   * Reads one protocol line with a deadline. On timeout the caller kills the process, which also
   * unblocks and ends the abandoned reader thread — so a stale read can never race a later one.
   */
  private String readLine(Duration timeout) throws IOException, TimeoutException {
    CompletableFuture<String> future =
        CompletableFuture.supplyAsync(
            () -> {
              try {
                return stdout.readLine();
              } catch (IOException e) {
                throw new java.io.UncheckedIOException(e);
              }
            },
            runnable -> Thread.ofVirtual().name("speech-worker-read").start(runnable));
    try {
      String line = future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
      if (line == null) {
        throw new IOException("speech worker exited (stdout closed)");
      }
      return line;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IOException("interrupted waiting for the speech worker", e);
    } catch (ExecutionException e) {
      throw new IOException("failed reading from the speech worker", e.getCause());
    }
  }

  private void drainStderr(Process p) {
    Thread.ofVirtual()
        .name("speech-worker-stderr")
        .start(
            () -> {
              try (BufferedReader reader =
                  new BufferedReader(
                      new InputStreamReader(p.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                  LOG.debugf("speech worker: %s", line);
                }
              } catch (IOException e) {
                LOG.debugf(e, "speech worker stderr drain ended");
              }
            });
  }

  @PreDestroy
  synchronized void stop() {
    if (process != null) {
      process.destroy();
      process = null;
      stdin = null;
      stdout = null;
    }
  }
}
