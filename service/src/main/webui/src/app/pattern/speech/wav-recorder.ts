import { signal } from '@angular/core';

export type RecorderStatus = 'idle' | 'recording';

/**
 * Records the microphone into a 16 kHz mono 16-bit WAV, returned base64-encoded on stop for the
 * server-side transcription endpoint. Plain Web Audio — no speech processing happens in the
 * browser (that's Parakeet's job on the backend).
 */
export class WavRecorder {
  readonly status = signal<RecorderStatus>('idle');
  /** Microphone input level 0..1, updated while recording — flat at 0 means no audio arrives. */
  readonly level = signal(0);
  readonly error = signal<string | null>(null);

  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];

  async start(): Promise<void> {
    if (this.status() !== 'idle') {
      return;
    }
    // Create/resume the audio context SYNCHRONOUSLY inside the click gesture — created after an
    // await it can start 'suspended' and record pure silence.
    this.audioContext ??= new AudioContext({ sampleRate: 16000 });
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }
    this.error.set(null);
    try {
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
      log(
        'recording from:',
        track?.label,
        'context rate =',
        this.audioContext.sampleRate,
        'state =',
        this.audioContext.state,
      );
      this.chunks = [];
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        this.chunks.push(new Float32Array(data));
        let peak = 0;
        for (const v of data) {
          peak = Math.max(peak, Math.abs(v));
        }
        this.level.set(Math.min(1, peak * 2));
      };
      this.source.connect(this.processor);
      // A ScriptProcessorNode only fires when wired into the graph; its output stays silent
      // because we never write the output buffer.
      this.processor.connect(this.audioContext.destination);
      this.status.set('recording');
    } catch (e) {
      log('start failed:', e);
      this.cleanup();
      this.error.set(describeStartError(e));
    }
  }

  /** Stops recording and returns the captured audio as a base64 WAV, or null if nothing came in. */
  stop(): string | null {
    if (this.status() !== 'recording') {
      return null;
    }
    this.cleanup();
    const sampleCount = this.chunks.reduce((n, c) => n + c.length, 0);
    log('stopped; captured', sampleCount, 'samples');
    if (sampleCount === 0) {
      return null;
    }
    const samples = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    return toBase64(encodeWav(samples, this.audioContext?.sampleRate ?? 16000));
  }

  private cleanup(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.level.set(0);
    this.status.set('idle');
  }
}

/** 16-bit PCM mono RIFF/WAVE encoding. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function log(...args: unknown[]): void {
  console.log('[speech]', ...args);
}

/** Turns a getUserMedia failure into a message the user can act on. */
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
  return e instanceof Error ? e.message : String(e);
}
