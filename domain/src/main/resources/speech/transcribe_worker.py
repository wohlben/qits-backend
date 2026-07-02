"""Long-lived transcription worker: NVIDIA Parakeet (ONNX, CPU-only) via onnx-asr.

Spawned by qits' SpeechWorker inside a service-managed venv. The model loads ONCE at
startup (that's the whole point — per-request python startup + model load costs seconds),
then the protocol is line-based:

    stdin:  one WAV file path per line
    stdout: one JSON object per line — {"text": "..."} or {"error": "..."}

A {"ready": true} line is printed once the models are loaded. stdout carries ONLY protocol
lines — everything else must go to stderr.
"""

import json
import sys
import wave

import onnx_asr

MODEL = "nemo-parakeet-tdt-0.6b-v2"

# Plain recognize() is limited to short clips (~30s); beyond this, segment with silero VAD.
PLAIN_RECOGNIZE_MAX_SECONDS = 25


def emit(payload) -> None:
    print(json.dumps(payload), flush=True)


def transcribe(model, vad, path: str) -> str:
    with wave.open(path) as w:
        duration = w.getnframes() / w.getframerate()
    if duration <= PLAIN_RECOGNIZE_MAX_SECONDS:
        return model.recognize(path).strip()
    segments = model.with_vad(vad).recognize(path)
    return " ".join(s.text.strip() for s in segments if s.text and s.text.strip())


def main() -> None:
    model = onnx_asr.load_model(MODEL, quantization="int8")
    vad = onnx_asr.load_vad("silero")
    emit({"ready": True})
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            emit({"text": transcribe(model, vad, path)})
        except Exception as e:  # noqa: BLE001 — the worker must survive any bad input
            emit({"error": str(e)})


if __name__ == "__main__":
    main()
