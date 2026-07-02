package eu.wohlben.qits.domain.speech.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.agent.control.ProcessExecutor;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(TranscriptionServiceTest.SpeechTestProfile.class)
public class TranscriptionServiceTest {

  public static class SpeechTestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-test-speech");
        return Map.of("qits.speech.home", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  /** Records bootstrap commands and plays back canned results — no venv or python involved. */
  static class FakeProcessExecutor extends ProcessExecutor {
    final List<List<String>> commands = new ArrayList<>();
    Result next = new Result(0, "", "", false);

    @Override
    public Result exec(List<String> command, Path cwd, Map<String, String> env, Duration timeout) {
      commands.add(command);
      return next;
    }
  }

  /** Records the staged WAV and plays back a canned transcript — no resident worker involved. */
  static class FakeSpeechWorker extends SpeechWorker {
    Path lastWav;
    byte[] lastWavBytes;
    RuntimeException failWith;

    @Override
    public synchronized String transcribe(Path wav) {
      this.lastWav = wav;
      try {
        this.lastWavBytes = Files.readAllBytes(wav);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
      if (failWith != null) {
        throw failWith;
      }
      return "hello world";
    }

    @Override
    public synchronized void ensureProcess() {}
  }

  @Inject TranscriptionService service;

  FakeProcessExecutor executor;
  FakeSpeechWorker worker;

  @BeforeEach
  public void setUp() {
    executor = new FakeProcessExecutor();
    worker = new FakeSpeechWorker();
    QuarkusMock.installMockForType(executor, ProcessExecutor.class);
    QuarkusMock.installMockForType(worker, SpeechWorker.class);
  }

  @Test
  public void bootstrapsTheVenvAndStagesTheAudioForTheWorker() {
    String text = service.transcribe(new byte[] {1, 2, 3});

    assertEquals("hello world", text);
    // No venv exists in the temp home, so it bootstraps (venv + pip) before transcribing.
    assertEquals(2, executor.commands.size());
    assertTrue(
        String.join(" ", executor.commands.get(0)).contains("-m venv"),
        executor.commands.toString());
    assertTrue(
        String.join(" ", executor.commands.get(1)).contains("onnx-asr"),
        executor.commands.toString());
    // The worker received the staged bytes; the temp file is cleaned up afterwards.
    assertEquals(
        List.of((byte) 1, (byte) 2, (byte) 3),
        List.of(worker.lastWavBytes[0], worker.lastWavBytes[1], worker.lastWavBytes[2]));
    assertTrue(worker.lastWav.toString().endsWith(".wav"), worker.lastWav.toString());
    assertTrue(!Files.exists(worker.lastWav), "staged wav should be deleted");
  }

  @Test
  public void materializesTheWorkerScriptIntoTheSpeechHome() {
    service.transcribe(new byte[] {1});

    // The speech home is where the staged wav went (config fields are proxied away).
    Path script = worker.lastWav.getParent().getParent().resolve("transcribe_worker.py");
    assertTrue(Files.exists(script), "worker script should be written to " + script);
  }

  @Test
  public void emptyAudioIsRejected() {
    assertThrows(BadRequestException.class, () -> service.transcribe(new byte[0]));
    assertThrows(BadRequestException.class, () -> service.transcribe(null));
  }

  @Test
  public void oversizedAudioIsRejected() {
    assertThrows(BadRequestException.class, () -> service.transcribe(new byte[31 * 1024 * 1024]));
  }

  @Test
  public void workerFailurePropagatesAsAServerError() {
    worker.failWith = new InternalServerErrorException("Transcription worker failed: boom");

    InternalServerErrorException e =
        assertThrows(InternalServerErrorException.class, () -> service.transcribe(new byte[] {1}));
    assertTrue(e.getMessage().contains("boom"), e.getMessage());
  }
}
