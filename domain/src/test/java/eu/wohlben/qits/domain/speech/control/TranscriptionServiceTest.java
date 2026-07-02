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

  /** Records executed commands and plays back canned results — no venv or python involved. */
  static class FakeProcessExecutor extends ProcessExecutor {
    final List<List<String>> commands = new ArrayList<>();
    Result next = new Result(0, "hello world\n", "", false);

    @Override
    public Result exec(List<String> command, Path cwd, Map<String, String> env, Duration timeout) {
      commands.add(command);
      return next;
    }
  }

  @Inject TranscriptionService service;

  FakeProcessExecutor executor;

  @BeforeEach
  public void setUp() {
    executor = new FakeProcessExecutor();
    QuarkusMock.installMockForType(executor, ProcessExecutor.class);
  }

  @Test
  public void bootstrapsTheVenvAndRunsTheRunnerScript() {
    String text = service.transcribe(new byte[] {1, 2, 3});

    assertEquals("hello world", text);
    // No venv exists in the temp home, so it bootstraps (venv + pip) before transcribing.
    assertEquals(3, executor.commands.size());
    assertTrue(
        String.join(" ", executor.commands.get(0)).contains("-m venv"),
        executor.commands.toString());
    assertTrue(
        String.join(" ", executor.commands.get(1)).contains("onnx-asr"),
        executor.commands.toString());
    List<String> transcribe = executor.commands.get(2);
    assertTrue(transcribe.get(1).endsWith("transcribe.py"), transcribe.toString());
    assertTrue(transcribe.get(2).endsWith(".wav"), transcribe.toString());
  }

  @Test
  public void materializesTheRunnerScriptIntoTheSpeechHome() {
    service.transcribe(new byte[] {1});

    // The runner path is whatever the service actually invoked (config fields are proxied away).
    Path script = Path.of(executor.commands.get(2).get(1));
    assertTrue(Files.exists(script), "runner script should be written to " + script);
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
  public void runnerFailureBecomesAServerError() {
    executor.next = new ProcessExecutor.Result(1, "", "ModuleNotFoundError: onnx_asr", false);

    InternalServerErrorException e =
        assertThrows(InternalServerErrorException.class, () -> service.transcribe(new byte[] {1}));
    assertTrue(e.getMessage().contains("onnx_asr"), e.getMessage());
  }

  @Test
  public void timeoutBecomesAServerError() {
    executor.next = new ProcessExecutor.Result(137, "", "", true);

    assertThrows(InternalServerErrorException.class, () -> service.transcribe(new byte[] {1}));
  }
}
