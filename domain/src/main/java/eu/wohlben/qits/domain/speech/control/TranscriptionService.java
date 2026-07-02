package eu.wohlben.qits.domain.speech.control;

import eu.wohlben.qits.domain.agent.control.ProcessExecutor;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Server-side speech-to-text with NVIDIA Parakeet (ONNX, CPU) — the browser records WAV segments
 * and this service transcribes them via the resident {@link SpeechWorker} (model loaded once, so
 * per-segment latency is inference-only). The python venv is bootstrapped lazily (python3 -m venv +
 * pip install) under {@code qits.speech.home}, and the model download (~700 MB from the Hugging
 * Face hub) is warmed up at startup when {@code qits.speech.warmup-on-start} is set, so the first
 * real request doesn't pay for it.
 *
 * <p>The worker script ships as a classpath resource and is re-materialized to disk on every
 * bootstrap check, so script changes deploy with the jar.
 */
@ApplicationScoped
public class TranscriptionService {

  private static final Logger LOG = Logger.getLogger(TranscriptionService.class);

  private static final String WORKER_RESOURCE = "/speech/transcribe_worker.py";

  private static final Duration BOOTSTRAP_TIMEOUT = Duration.ofMinutes(10);

  /** ~30 MB ≈ 16 minutes of 16 kHz mono 16-bit WAV — far beyond any spoken task description. */
  private static final int MAX_WAV_BYTES = 30 * 1024 * 1024;

  @Inject ProcessExecutor processExecutor;

  @Inject SpeechWorker speechWorker;

  @ConfigProperty(name = "qits.speech.home", defaultValue = "data/speech")
  String speechHome;

  @ConfigProperty(name = "qits.speech.python", defaultValue = "python3")
  String pythonBinary;

  @ConfigProperty(name = "qits.speech.warmup-on-start", defaultValue = "false")
  boolean warmupOnStart;

  /** Kicks the venv bootstrap + worker spawn (= model download/load) off the startup path. */
  void onStart(@Observes StartupEvent event) {
    if (!warmupOnStart) {
      return;
    }
    Thread.ofVirtual()
        .name("speech-warmup")
        .start(
            () -> {
              try {
                ensureReady();
                speechWorker.ensureProcess();
              } catch (Exception e) {
                LOG.warnf(e, "Speech warmup failed — first transcription will be slow or error.");
              }
            });
  }

  /** Transcribes a WAV recording (any common PCM rate; onnx-asr resamples) to plain text. */
  public String transcribe(byte[] wav) {
    if (wav == null || wav.length == 0) {
      throw new BadRequestException("audio is required");
    }
    if (wav.length > MAX_WAV_BYTES) {
      throw new BadRequestException("audio too large (max " + MAX_WAV_BYTES + " bytes)");
    }
    ensureReady();

    Path tmp = home().resolve("tmp").resolve(UUID.randomUUID() + ".wav");
    try {
      Files.createDirectories(tmp.getParent());
      Files.write(tmp, wav);
      return speechWorker.transcribe(tmp);
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to stage audio for transcription", e);
    } finally {
      try {
        Files.deleteIfExists(tmp);
      } catch (IOException e) {
        LOG.debugf(e, "Failed to delete staged audio %s", tmp);
      }
    }
  }

  /**
   * Materializes the worker script and bootstraps the venv (python3 -m venv + pip install) if it
   * doesn't exist yet. Synchronized so a warmup and a first request can't bootstrap twice.
   */
  synchronized void ensureReady() {
    try {
      Files.createDirectories(home());
      try (InputStream in = TranscriptionService.class.getResourceAsStream(WORKER_RESOURCE)) {
        if (in == null) {
          throw new InternalServerErrorException("Worker resource missing: " + WORKER_RESOURCE);
        }
        Files.copy(in, workerScript(), StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to prepare speech home " + home(), e);
    }

    if (Files.exists(venvPython())) {
      return;
    }
    LOG.infof("Bootstrapping speech venv under %s (one-time)…", home());
    run(
        List.of(pythonBinary, "-m", "venv", home().resolve("venv").toString()),
        "create the speech venv (is python3 with the venv module installed?)");
    run(
        List.of(
            home().resolve("venv").resolve("bin").resolve("pip").toString(),
            "install",
            "--quiet",
            "onnx-asr[cpu,hub]"),
        "install onnx-asr into the speech venv");
    LOG.info("Speech venv ready.");
  }

  private void run(List<String> command, String description) {
    ProcessExecutor.Result result =
        processExecutor.exec(command, home(), Map.of(), BOOTSTRAP_TIMEOUT);
    if (result.timedOut() || result.exitCode() != 0) {
      throw new InternalServerErrorException(
          "Failed to " + description + ": " + tail(result.stderr()));
    }
  }

  private Path home() {
    return Path.of(speechHome).toAbsolutePath();
  }

  private Path venvPython() {
    return home().resolve("venv").resolve("bin").resolve("python");
  }

  private Path workerScript() {
    return home().resolve("transcribe_worker.py");
  }

  private static String tail(String text) {
    String stripped = text == null ? "" : text.strip();
    int max = 500;
    return stripped.length() <= max ? stripped : stripped.substring(stripped.length() - max);
  }
}
