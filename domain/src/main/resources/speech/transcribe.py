"""Transcribe a WAV file with NVIDIA Parakeet (ONNX, CPU-only) via onnx-asr.

Invoked by qits' TranscriptionService inside a service-managed venv:
    python transcribe.py <file.wav>   -> prints the transcript to stdout
    python transcribe.py --warmup     -> downloads/caches the models, prints "ready"

Models download from the Hugging Face hub into its local cache on first use
(~700 MB for the int8 parakeet weights); the service warms this up at startup.
stdout carries ONLY the transcript — everything else must go to stderr.
"""

import sys
import wave

import onnx_asr

MODEL = "nemo-parakeet-tdt-0.6b-v2"

# Plain recognize() is limited to short clips (~30s); beyond this, segment with silero VAD.
PLAIN_RECOGNIZE_MAX_SECONDS = 25


def load():
    return onnx_asr.load_model(MODEL, quantization="int8")


def main() -> None:
    if "--warmup" in sys.argv:
        load()
        onnx_asr.load_vad("silero")
        print("ready")
        return

    path = sys.argv[1]
    with wave.open(path) as w:
        duration = w.getnframes() / w.getframerate()

    model = load()
    if duration <= PLAIN_RECOGNIZE_MAX_SECONDS:
        print(model.recognize(path).strip())
    else:
        segments = model.with_vad(onnx_asr.load_vad("silero")).recognize(path)
        print(" ".join(s.text.strip() for s in segments if s.text and s.text.strip()))


if __name__ == "__main__":
    main()
