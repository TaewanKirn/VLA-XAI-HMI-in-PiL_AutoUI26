"""
OpenWakeWord → WebSocket bridge.

Listens to the default microphone, runs the wake-word model, and broadcasts a
JSON event to every connected WebSocket client when the score crosses the
threshold. The React app subscribes to these events and triggers its STT flow.

Usage:
    python server.py                              # built-in hey_jarvis (English)
    python server.py --model ./jain_a.onnx       # custom Korean model
    python server.py --model ./jain_a.onnx --threshold 0.55 --port 8765
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
import websockets
from openwakeword.model import Model
from openwakeword.utils import download_models

SAMPLE_RATE = 16000
CHUNK = 1280   # 80 ms — recommended by openwakeword
COOLDOWN_S = 1.5  # suppress repeat fires within this window


async def broadcast(clients, payload):
    if not clients:
        return
    msg = json.dumps(payload, ensure_ascii=False)
    await asyncio.gather(
        *(c.send(msg) for c in list(clients)),
        return_exceptions=True,
    )


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        help="Path to a custom openwakeword model (.onnx or .tflite). "
             "If omitted, the built-in 'hey_jarvis' model is used.",
    )
    parser.add_argument("--label", default=None,
                        help="Label sent in the wake event (defaults to model filename or 'hey_jarvis').")
    parser.add_argument("--threshold", type=float, default=0.5,
                        help="Detection threshold in [0, 1]. Default 0.5.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--inference-framework", default="onnx", choices=["onnx", "tflite"])
    args = parser.parse_args()

    if args.model:
        model_path = Path(args.model)
        if not model_path.exists():
            print(f"[wake] model file not found: {model_path}", file=sys.stderr)
            sys.exit(1)
        label = args.label or model_path.stem
        oww = Model(
            wakeword_models=[str(model_path)],
            inference_framework=args.inference_framework,
        )
    else:
        # First run downloads the bundled models (~few MB).
        download_models()
        label = args.label or "hey_jarvis"
        oww = Model(
            wakeword_models=["hey_jarvis"],
            inference_framework=args.inference_framework,
        )
        print("[wake] No --model supplied; using built-in 'hey_jarvis'. "
              "Train a Korean '자인아' model to swap in.")

    clients: set = set()
    loop = asyncio.get_running_loop()
    last_fire = 0.0

    def audio_callback(indata, frames, time_info, status):
        nonlocal last_fire
        if status:
            print(f"[wake] audio status: {status}", file=sys.stderr)
        # indata is float32 in [-1, 1]; openwakeword expects int16 PCM.
        pcm = (indata[:, 0] * 32767).astype(np.int16)
        scores = oww.predict(pcm)
        for kw, score in scores.items():
            if score >= args.threshold and (time.monotonic() - last_fire) > COOLDOWN_S:
                last_fire = time.monotonic()
                payload = {"event": "wake", "label": label, "keyword": kw, "score": float(score)}
                print(f"[wake] detected {kw} score={score:.3f}")
                asyncio.run_coroutine_threadsafe(broadcast(clients, payload), loop)

    async def handler(ws):
        clients.add(ws)
        peer = ws.remote_address
        print(f"[wake] client connected: {peer} (total={len(clients)})")
        try:
            await ws.send(json.dumps({"event": "ready", "label": label}))
            async for _ in ws:
                pass  # ignore incoming messages
        finally:
            clients.discard(ws)
            print(f"[wake] client disconnected: {peer} (total={len(clients)})")

    stream = sd.InputStream(
        channels=1,
        samplerate=SAMPLE_RATE,
        blocksize=CHUNK,
        dtype="float32",
        callback=audio_callback,
    )
    stream.start()
    print(f"[wake] listening on ws://{args.host}:{args.port} (label={label}, threshold={args.threshold})")

    try:
        async with websockets.serve(handler, args.host, args.port):
            await asyncio.Future()  # run forever
    finally:
        stream.stop()
        stream.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[wake] stopped.")
