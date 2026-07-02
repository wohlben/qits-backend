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
  /** Microphone input level 0..1, updated while recording — flat at 0 means no audio arrives. */
  readonly level = signal(0);
  readonly error = signal<string | null>(null);

  private transcriber: import('@usefulsensors/moonshine-js').Transcriber | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private meterSource: MediaStreamAudioSourceNode | null = null;
  private meterFrame = 0;

  constructor(private readonly onUtterance: (text: string) => void) {}

  async start(): Promise<void> {
    if (this.status() !== 'idle') {
      return;
    }
    // Create/resume the audio context SYNCHRONOUSLY inside the click gesture. The awaits below
    // (dynamic import, 60MB model download) outlive Chrome's transient user activation (~5s); a
    // context created after that starts 'suspended' and the VAD then processes zero frames —
    // recording looks active but nothing ever transcribes.
    this.audioContext ??= new AudioContext();
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }
    log('start: audio context state =', this.audioContext.state);

    this.status.set('loading');
    this.error.set(null);
    try {
      const moonshine = await import('@usefulsensors/moonshine-js');
      log('moonshine-js imported');
      moonshine.Settings.VERBOSE_LOGGING = true;
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
            onModelLoadStarted: () => log('model load started (downloads on first use)'),
            onModelLoaded: () => log('model + VAD loaded'),
            onTranscribeStarted: () => log('transcription started'),
            onTranscribeStopped: () => log('transcription stopped'),
            onTranscriptionUpdated: (text) => log('transcription updated:', text),
            onTranscriptionCommitted: (text) => {
              log('utterance committed:', text);
              if (text?.trim()) {
                this.onUtterance(text.trim());
              }
            },
            onSpeechStart: () => {
              log('VAD: speech started');
              this.speaking.set(true);
            },
            onSpeechEnd: () => {
              log('VAD: speech ended');
              this.speaking.set(false);
            },
            onError: (error) => {
              log('error callback:', error);
              this.error.set(String(error));
              this.stop();
            },
          },
          true,
        );
        // Swap the library's own AudioContext (created in its constructor, possibly outside the
        // user gesture by the time the import resolves) for ours, which is guaranteed running.
        const internal = this.transcriber as unknown as { audioContext: AudioContext };
        void internal.audioContext.close();
        internal.audioContext = this.audioContext;
        log('transcriber constructed, audio context swapped in');
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
      const track = this.stream.getAudioTracks()[0];
      log('microphone acquired:', track?.label, JSON.stringify(track?.getSettings?.() ?? {}));
      this.transcriber.attachStream(this.stream);
      await this.transcriber.start();
      if (this.audioContext.state !== 'running') {
        log('audio context still', this.audioContext.state, '- trying to resume');
        await this.audioContext.resume();
      }
      this.startMeter();
      log('recording; audio context state =', this.audioContext.state);
      if (this.audioContext.state !== 'running') {
        this.stop();
        this.error.set(
          'The browser blocked audio processing (no user activation left). Press Record again — ' +
            'everything is cached now, so the second attempt starts fast enough.',
        );
        return;
      }
      this.status.set('recording');
    } catch (e) {
      log('start failed:', e);
      this.releaseStream();
      this.status.set('idle');
      this.error.set(describeStartError(e));
    }
  }

  stop(): void {
    log('stop');
    this.transcriber?.stop();
    this.stopMeter();
    this.releaseStream();
    this.speaking.set(false);
    this.status.set('idle');
  }

  /** Feeds the mic stream into an analyser and mirrors the peak level into {@link level}. */
  private startMeter(): void {
    if (!this.audioContext || !this.stream) {
      return;
    }
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.meterSource = this.audioContext.createMediaStreamSource(this.stream);
    this.meterSource.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) {
        peak = Math.max(peak, Math.abs(v - 128));
      }
      this.level.set(Math.min(1, peak / 64));
      this.meterFrame = requestAnimationFrame(tick);
    };
    this.meterFrame = requestAnimationFrame(tick);
  }

  private stopMeter(): void {
    cancelAnimationFrame(this.meterFrame);
    this.meterSource?.disconnect();
    this.meterSource = null;
    this.level.set(0);
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

function log(...args: unknown[]): void {
  // Deliberately chatty: speech capture has many silent failure modes (suspended audio context,
  // muted mic, VAD never triggering) that only these traces can tell apart.
  console.log('[speech]', ...args);
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
