#!/usr/bin/env python3
"""Pip voice v1 narration for the 10x scene: Qwen3-TTS Base + approved B-US reference (run with .venv-qwen). Loads ONLY the Base model."""
from __future__ import annotations

import hashlib
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "reference" / "pip-voice" / "approved-v1"
REF_WAV = REF_DIR / "pip_qwen_B-US_general_american.wav"
OUT = ROOT / "audio" / "pip-scene-10x" / "takes"
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
MAX_TOKENS = 600  # safety cap (12.5 tokens/s = 48 s)

NARRATION = (
    "Ten times faster. Sounds impressive. But faster at what? This test used tiny prompts. "
    "A long document is a different workload. Before trusting the headline, check what was measured."
)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    from mlx_audio.tts.utils import load_model

    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    approved = json.loads((REF_DIR / "approved.json").read_text())
    assert sha(REF_WAV) == approved["files"]["wav"]["sha256"], "approved WAV does not match its recorded checksum"
    OUT.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    model = load_model(MODEL_ID)
    mx.eval(model.parameters())
    load_s = time.time() - t0
    mx.random.seed(seed)
    mx.reset_peak_memory()
    t = time.time()
    chunks, sr, segs = [], None, 0
    for r in model.generate(text=NARRATION, ref_audio=str(REF_WAV), ref_text=approved["script"], lang_code="english", max_tokens=MAX_TOKENS):
        chunks.append(np.array(r.audio, dtype=np.float32))
        sr = r.sample_rate
        segs += 1
    gen_s = time.time() - t
    audio = np.concatenate(chunks)
    raw = OUT / f"narration_seed{seed}.wav"
    wavfile.write(raw, sr, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
    meta = {
        "voice": "Pip voice v1 = Qwen3-TTS Base + approved B-US reference", "model": MODEL_ID, "reference_wav": str(REF_WAV.relative_to(ROOT)),
        "reference_sha256": sha(REF_WAV), "reference_text": approved["script"], "narration": NARRATION, "seed": seed,
        "sampling": {"temperature": 0.9, "top_k": 50, "top_p": 1.0, "repetition_penalty": "1.05 default, raised to 1.5 by mlx-audio in reference mode"},
        "max_tokens_cap": MAX_TOKENS, "segments": segs, "sample_rate": sr, "duration_s": round(len(audio) / sr, 3),
        "load_seconds": round(load_s, 1), "generation_seconds": round(gen_s, 1), "real_time_factor": round(gen_s / (len(audio) / sr), 2),
        "mlx_peak_memory_gb": round(mx.get_peak_memory() / 1024**3, 2), "mlx_active_after_load_gb": round(mx.get_active_memory() / 1024**3, 2),
        "process_peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**3, 2),
        "reference_unchanged_after": sha(REF_WAV) == approved["files"]["wav"]["sha256"],
    }
    (OUT / f"narration_seed{seed}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(json.dumps(meta), flush=True)


if __name__ == "__main__":
    main()
