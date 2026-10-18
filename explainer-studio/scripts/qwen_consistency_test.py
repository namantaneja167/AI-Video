#!/usr/bin/env python3
"""Reference-based voice consistency test: Qwen3-TTS Base + approved B-US WAV and its exact transcript. Loads ONLY the Base model."""
from __future__ import annotations

import hashlib
import json
import resource
import subprocess
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "reference" / "pip-voice" / "approved-v1"
REF_WAV = REF_DIR / "pip_qwen_B-US_general_american.wav"
OUT = ROOT / "audio" / "pip-voice-qwen-consistency"
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
SEED = 7
MAX_TOKENS = 500  # safety cap (12.5 tokens/s = 40 s) against runaway generation; passages need about 150

PASSAGES = {
    "1": ("launch", "A new notes app just launched with an interesting promise: it can turn your scattered ideas into a searchable workspace. "
                    "Sounds useful. Let\u2019s see what it actually does."),
    "2": ("technical", "Before generating an answer, a language model processes the input it receives. "
                       "Longer inputs generally mean more work, although caching can reduce repeated processing."),
    "3": ("skeptical", "Ten times faster. Really? Compared to what, exactly? That number needs context: the task, the hardware, and how speed was measured."),
}


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rss_gb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**3


def main() -> None:
    from mlx_audio.tts.utils import load_model

    approved = json.loads((REF_DIR / "approved.json").read_text())
    ref_text = approved["script"]
    sha_before = sha(REF_WAV)
    assert sha_before == approved["files"]["wav"]["sha256"], "approved WAV does not match its recorded checksum"
    OUT.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    model = load_model(MODEL_ID)
    mx.eval(model.parameters())
    info = {"model": MODEL_ID, "reference_wav": str(REF_WAV.relative_to(ROOT)), "reference_sha256": sha_before, "reference_text": ref_text,
            "method": "model.generate(text, ref_audio=<approved WAV>, ref_text=<its exact script>, lang_code='english'); no instruct, no voice preset",
            "seed_per_passage": SEED, "temperature": 0.9, "top_k": 50, "top_p": 1.0,
            "repetition_penalty": "library default 1.05, raised to 1.5 by mlx-audio in reference mode", "max_tokens_cap": MAX_TOKENS,
            "load_seconds": round(time.time() - t0, 1), "mlx_active_after_load_gb": round(mx.get_active_memory() / 1024**3, 2),
            "rss_after_load_gb": round(rss_gb(), 2), "passages": {}}
    print("loaded", info["load_seconds"], "s, active", info["mlx_active_after_load_gb"], "GB", flush=True)

    for k, (name, text) in PASSAGES.items():
        mx.random.seed(SEED)
        mx.reset_peak_memory()
        t = time.time()
        chunks, sr, segs, first = [], None, 0, None
        for r in model.generate(text=text, ref_audio=str(REF_WAV), ref_text=ref_text, lang_code="english", max_tokens=MAX_TOKENS):
            if first is None:
                first = time.time() - t
            chunks.append(np.array(r.audio, dtype=np.float32)); sr = r.sample_rate; segs += 1
        gen_s = time.time() - t
        audio = np.concatenate(chunks)
        dur = len(audio) / sr
        wav = OUT / f"pip_consistency_{k}_{name}.wav"
        wavfile.write(wav, sr, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
        mp3 = wav.with_suffix(".mp3")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "192k", str(mp3)], check=True)
        words = len(text.split())
        info["passages"][k] = {"name": name, "text": text, "words": words, "segments": segs, "sample_rate": sr, "duration_s": round(dur, 2),
                               "words_per_minute": round(words / dur * 60), "generation_seconds": round(gen_s, 1), "real_time_factor": round(gen_s / dur, 2),
                               "first_audio_seconds": round(first, 1), "mlx_peak_memory_gb": round(mx.get_peak_memory() / 1024**3, 2),
                               "mlx_active_after_gb": round(mx.get_active_memory() / 1024**3, 2), "process_peak_rss_gb": round(rss_gb(), 2),
                               "files": {"wav": wav.name, "mp3": mp3.name}}
        print(k, json.dumps(info["passages"][k]), flush=True)
        mx.clear_cache()

    info["reference_unchanged_after"] = sha(REF_WAV) == sha_before
    (OUT / "settings.json").write_text(json.dumps(info, indent=2, ensure_ascii=False))
    print("done", flush=True)


if __name__ == "__main__":
    main()
