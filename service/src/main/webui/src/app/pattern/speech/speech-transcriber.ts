import { signal } from '@angular/core';

export type TranscriberStatus = 'idle' | 'loading' | 'recording';

/**
 * Owns the Moonshine (moonshine-js) microphone-transcription lifecycle and exposes it as signals.
 * All speech recognition runs locally in the browser (ONNX Runtime Web); audio never leaves the
 * machine. The library is imported dynamically so its ~large runtime only loads with the route
 * that records.
 *
 * VAD mode is used, so text arrives per utterance: `onUtterance` fires at every natural pause
 * with that segment's transcript. Utterances can land shortly *after* {@link stop} (the final
 * inference is async) — consumers should simply keep appending. The mic stream is owned here
 * (not by the library's MicrophoneTranscriber, which re-acquires and never releases streams) so
 * the browser's recording indicator turns off on stop.
 */
export class SpeechTranscriber {
  readonly status = signal<TranscriberStatus>('idle');
  /** True while the voice-activity detector hears speech (drives a "listening" indicator). */
  readonly speaking = signal(false);
  readonly error = signal<string | null>(null);

  private transcriber: import('@usefulsensors/moonshine-js').Transcriber | null = null;
  private stream: MediaStream | null = null;

  constructor(private readonly onUtterance: (text: string) => void) {}

  async start(): Promise<void> {
    if (this.status() !== 'idle') {
      return;
    }
    this.status.set('loading');
    this.error.set(null);
    try {
      const moonshine = await import('@usefulsensors/moonshine-js');
      if (!this.transcriber) {
        // The default asset path is the package's @latest CDN URL, which no longer ships the
        // English base model — pin to the last version that does. VAD assets are pinned to the
        // exact dependency version for the same reason.
        moonshine.Settings.BASE_ASSET_PATH.MOONSHINE =
          'https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@0.1.16/dist/';
        moonshine.Settings.BASE_ASSET_PATH.SILERO_VAD =
          'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.22/dist/';
        this.transcriber = new moonshine.Transcriber(
          'model/base',
          {
            onTranscriptionCommitted: (text) => {
              if (text?.trim()) {
                this.onUtterance(text.trim());
              }
            },
            onSpeechStart: () => this.speaking.set(true),
            onSpeechEnd: () => this.speaking.set(false),
            onError: (error) => {
              this.error.set(String(error));
              this.stop();
            },
          },
          true,
        );
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      this.transcriber.attachStream(this.stream);
      await this.transcriber.start();
      this.status.set('recording');
    } catch (e) {
      this.releaseStream();
      this.status.set('idle');
      this.error.set(describeStartError(e));
    }
  }

  stop(): void {
    this.transcriber?.stop();
    this.releaseStream();
    this.speaking.set(false);
    this.status.set('idle');
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

/** Turns a getUserMedia/model-load failure into a message the user can act on. */
function describeStartError(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return (
          'Microphone access was denied. Allow the microphone for this site in the browser ' +
          '(padlock icon next to the address bar → Site settings → Microphone), then try again. ' +
          'On Windows also check Settings → Privacy → Microphone.'
        );
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No microphone was found. Connect one (or check the browser can see it) and try again.';
      case 'NotReadableError':
        return 'The microphone is already in use by another application.';
    }
  }
  const message = e instanceof Error ? e.message : String(e);
  return /fetch|network|load/i.test(message)
    ? message + ' — the speech model download may have failed; check the network.'
    : message;
}
