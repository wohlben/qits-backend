/**
 * Ambient types for `@usefulsensors/moonshine-js` — the package ships no `.d.ts`. Only the
 * surface the speech feature uses is declared (see `src/` in the package for the full API).
 */
declare module '@usefulsensors/moonshine-js' {
  export interface TranscriberCallbacks {
    onPermissionsRequested: () => unknown;
    onError: (error: unknown) => unknown;
    onModelLoadStarted: () => unknown;
    onModelLoaded: () => unknown;
    onTranscribeStarted: () => unknown;
    onTranscribeStopped: () => unknown;
    onTranscriptionUpdated: (text: string | undefined) => unknown;
    onTranscriptionCommitted: (text: string | undefined) => unknown;
    onSpeechStart: () => unknown;
    onSpeechEnd: () => unknown;
  }

  export class Transcriber {
    constructor(modelURL: string, callbacks?: Partial<TranscriberCallbacks>, useVAD?: boolean);
    isActive: boolean;
    attachStream(stream: MediaStream): void;
    start(): Promise<void>;
    stop(): void;
  }

  export class MicrophoneTranscriber extends Transcriber {}

  export const Settings: {
    FRAME_SIZE: number;
    STREAM_UPDATE_INTERVAL: number;
    STREAM_COMMIT_INTERVAL: number;
    VAD_COMMIT_INTERVAL: number;
    BASE_ASSET_PATH: {
      MOONSHINE: string;
      ONNX_RUNTIME: string;
      SILERO_VAD: string;
    };
    VERBOSE_LOGGING: boolean;
  };
}
