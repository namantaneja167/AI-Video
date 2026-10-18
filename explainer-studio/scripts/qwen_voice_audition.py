#!/usr/bin/env python3
"""Two Qwen3-TTS VoiceDesign auditions (run with .venv-qwen). No silence insertion, no blending, no cloning."""
from __future__ import annotations

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
OUT = ROOT / "audio" / "pip-voice-qwen-auditions"
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
SEED = 7

SCRIPT = (
    "Ten times faster. Sounds impressive. But faster at what? Give an AI a short question and it might respond instantly. "
    "Give it a long document, and the story can change. Let\u2019s see what that headline actually means."
)

VOICES = {
    "A": {
        "name": "warm_curious",
        "instruct": (
            "A warm, youthful adult voice with a medium pitch. Conversational and curious, like an engaging tech presenter "
            "explaining something to a friend. Lively but restrained emphasis, natural rhythm, clear articulation. "
            "Not breathy, not an advertising announcer, no cartoon quality."
        ),
    },
    "B": {
        "name": "mischievous_dry",
        "instruct": (
            "A confident adult voice with a medium pitch and a slightly mischievous, dry sense of humor. Natural conversational "
            "rhythm, like an engaging tech presenter. Inquisitive, rising emphasis on the question 'faster at what?'. "
            "Understated, not sarcastic, not breathy, not an announcer, no cartoon quality."
        ),
    },
}


# Accent variants: B's exact prompt plus one positive accent sentence; model, seed, script and settings are unchanged.
ACCENTS = {
    "B-US": ("general_american", "General American English",
             "Speaks General American English, with natural American stress and intonation, clear consonants and conversational phrasing."),
    "B-IN": ("urban_indian", "clear urban Indian English",
             "Speaks clear, natural urban Indian English, as an educated professional from an Indian city would, with natural English stress "
             "and intonation, clear consonants and conversational phrasing."),
}
ACCENT_VOICES = {k: {"name": n, "requested_accent": label, "instruct": f"{a} {VOICES['B']['instruct']}"} for k, (n, label, a) in ACCENTS.items()}


def rss_gb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**3  # macOS reports bytes


def main() -> None:
    from mlx_audio.tts.utils import load_model

    voices, out = VOICES, OUT
    if "--accents" in sys.argv:
        voices, out = ACCENT_VOICES, ROOT / "audio" / "pip-voice-qwen-accents"
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    model = load_model(MODEL_ID)
    mx.eval(model.parameters())
    load_s = time.time() - t0
    info = {"model": MODEL_ID, "mlx_load_seconds": round(load_s, 1), "rss_after_load_gb": round(rss_gb(), 2),
            "mlx_active_after_load_gb": round(mx.get_active_memory() / 1024**3, 2), "script": SCRIPT, "seed": SEED,
            "sampling_defaults": {"temperature": 0.9, "top_k": 50, "top_p": 1.0, "repetition_penalty": 1.05, "max_tokens": 4096},
            "auditions": {}}
    print(f"loaded in {load_s:.1f}s, rss {info['rss_after_load_gb']} GB", flush=True)

    for key, v in voices.items():
        mx.random.seed(SEED)
        mx.reset_peak_memory()
        t = time.time()
        chunks, sr, segs = [], None, 0
        for r in model.generate_voice_design(text=SCRIPT, instruct=v["instruct"], language="English"):
            chunks.append(np.array(r.audio, dtype=np.float32))
            sr = r.sample_rate
            segs += 1
        gen_s = time.time() - t
        audio = np.concatenate(chunks)
        dur = len(audio) / sr
        raw = out / f"pip_qwen_{key}_{v['name']}.wav"
        wavfile.write(raw, sr, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
        mp3 = raw.with_suffix(".mp3")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-codec:a", "libmp3lame", "-b:a", "192k", str(mp3)], check=True)
        info["auditions"][key] = {
            "name": v["name"], "requested_accent": v.get("requested_accent"), "instruct": v["instruct"], "segments_returned": segs, "sample_rate": sr,
            "duration_s": round(dur, 2), "generation_seconds": round(gen_s, 1), "real_time_factor": round(gen_s / dur, 2),
            "mlx_peak_memory_gb": round(mx.get_peak_memory() / 1024**3, 2), "process_peak_rss_gb": round(rss_gb(), 2),
            "files": {"wav": raw.name, "mp3": mp3.name},
        }
        print(key, json.dumps(info["auditions"][key]), flush=True)
    (out / "settings.json").write_text(json.dumps(info, indent=2, ensure_ascii=False))
    print("done", flush=True)


if __name__ == "__main__":
    main()
