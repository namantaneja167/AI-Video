#!/usr/bin/env python3
"""Mix builder: place block takes on the planned layout and write 48 kHz mono 16-bit WAV (run with .venv-qwen).

stdin JSON: {out, total_sec, blocks: [{wav, offset_sec}], master: null | {lufs, true_peak_db, lra}}
draft = placement only; final = placement + loudness mastering (ffmpeg loudnorm). stdout JSON: measured facts.
Sound accents are not part of this phase: the mix is narration only.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000


def read_mono(path: str) -> np.ndarray:
    sr, y = wavfile.read(path)
    y = y.astype(np.float32) / 32768 if y.dtype == np.int16 else y.astype(np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr != SR:
        g = math.gcd(SR, sr)
        y = signal.resample_poly(y, SR // g, sr // g).astype(np.float32)
    return y


def write16(path: str, y: np.ndarray) -> None:
    wavfile.write(path, SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))


def ffmpeg(args: list[str]) -> str:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-y", *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"ffmpeg failed: {r.stderr[-400:]}")
    return r.stderr


def measure(path: str) -> dict:
    err = ffmpeg(["-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = err[err.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    p = re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail)
    return {"integrated_lufs": float(i.group(1)) if i else None, "true_peak_dbfs": float(p.group(1)) if p else None}


def main() -> None:
    req = json.load(sys.stdin)
    n_total = int(round(req["total_sec"] * SR))
    y = np.zeros(n_total, dtype=np.float32)
    for b in req["blocks"]:
        a = read_mono(b["wav"])
        o = int(round(b["offset_sec"] * SR))
        if o + len(a) > n_total:
            raise SystemExit(f"take {b['wav']} runs past the planned end ({(o + len(a)) / SR:.3f}s > {req['total_sec']}s)")
        y[o : o + len(a)] += a
    out = req["out"]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    facts: dict = {"samples": n_total, "sample_rate": SR, "mode": "final" if req.get("master") else "draft"}
    if not req.get("master"):
        write16(out, y)
    else:
        m = req["master"]
        with tempfile.TemporaryDirectory() as td:
            raw, mastered = f"{td}/raw.wav", f"{td}/mastered.wav"
            write16(raw, y)
            ffmpeg(["-i", raw, "-af", f"loudnorm=I={m['lufs']}:TP={m['true_peak_db']}:LRA={m['lra']}", "-ar", str(SR), "-ac", "1", mastered])
            z = read_mono(mastered)
            z = z[:n_total] if len(z) >= n_total else np.pad(z, (0, n_total - len(z)))
            write16(out, z)
        facts["target"] = m
    facts["measured"] = measure(out)
    json.dump(facts, sys.stdout)


if __name__ == "__main__":
    main()
