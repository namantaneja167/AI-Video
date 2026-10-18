#!/usr/bin/env python3
"""Mix builder: place block takes on the planned layout and write 48 kHz mono 16-bit WAV (run with .venv-qwen).

stdin JSON: {out, total_sec, blocks: [{wav, offset_sec}], gain_db?, master: null | {lufs, true_peak_db, lra},
             accents?: [{accent, t, gain_db, params}], accent_bus_db?, accent_duck?}
draft = placement only. final = the COMPLETE mix (voice + accents) is mastered: accents are mixed in before mastering at the level
they will have in the result (ducked under the voice), then one gain and a peak limiter bring the whole
mix to the loudness target without exceeding the true-peak ceiling. The gain is solved by measurement (workers/accents.py is
imported only when there are accents). stdout JSON: measured facts.
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


# Peak control only: no compressor, so the narrator's dynamics are untouched except where a peak would pass the ceiling. (A 2:1
# compressor ahead of the limiter was measured: it lands the same loudness but alters most of the speech; see the Phase 3 report.)
LIMITER_ATTACK_MS, LIMITER_RELEASE_MS = 5, 60
TP_MARGIN_DB = 0.3  # the limiter's sample-peak ceiling sits this far under the true-peak target; the written file is then measured


def master_complete(voice: np.ndarray, sfx: np.ndarray | None, m: dict, out: str, n_total: int) -> dict:
    """Master voice + accents together. The accents are synthesised at the level they should have in the result, so they are
    scaled down by the gain before it is applied (the gain is solved by measurement, so this is iterated)."""
    target, tp = float(m["lufs"]), float(m["true_peak_db"])
    delay = int(round(LIMITER_ATTACK_MS * SR / 1000))  # the limiter looks ahead by its attack time and delays the output
    with tempfile.TemporaryDirectory() as td:
        src, dst = f"{td}/src.wav", f"{td}/dst.wav"
        wavfile.write(src, SR, voice.astype(np.float32))
        raw_i = measure(src)["integrated_lufs"]
        if raw_i is None or raw_i < -60:
            write16(out, voice + (sfx if sfx is not None else 0))
            return {"skipped": "the signal is below -60 LUFS; nothing was mastered", "raw_voice_lufs": raw_i}

        def render(gain_db: float, limit_db: float) -> np.ndarray:
            mixed = voice + (sfx * 10 ** (-gain_db / 20) if sfx is not None else 0)
            wavfile.write(src, SR, mixed.astype(np.float32))
            chain = f"volume={gain_db}dB,alimiter=limit={10 ** (limit_db / 20):.5f}:attack={LIMITER_ATTACK_MS}:release={LIMITER_RELEASE_MS}:level=disabled"
            ffmpeg(["-i", src, "-af", chain, "-ar", str(SR), "-ac", "1", "-c:a", "pcm_f32le", dst])
            z = read_mono(dst)[delay:]
            return z[:n_total] if len(z) >= n_total else np.pad(z, (0, n_total - len(z)))

        gain, limit_db, passes = target - raw_i, tp - TP_MARGIN_DB, 0
        for _ in range(3):  # true-peak verification
            for _ in range(8):  # loudness
                passes += 1
                write16(out, render(gain, limit_db))
                got = measure(out)
                err = target - got["integrated_lufs"]
                if abs(err) < 0.05:
                    break
                gain += err
            if got["true_peak_dbfs"] <= tp:
                break
            limit_db -= got["true_peak_dbfs"] - tp + 0.1
    return {"order": "voice and accents mixed, then mastered" if sfx is not None else "voice mastered", "raw_voice_lufs": raw_i, "gain_db": round(gain, 2), "compressor": None,
            "limiter": {"limit_db": round(limit_db, 2), "attack_ms": LIMITER_ATTACK_MS, "release_ms": LIMITER_RELEASE_MS},
            "accent_scale_db": round(-gain, 2) if sfx is not None else None, "passes": passes}


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
    y *= 10 ** (float(req.get("gain_db", 0.0)) / 20)
    out = req["out"]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    events = req.get("accents") or []
    facts: dict = {"gain_db": float(req.get("gain_db", 0.0)), "samples": n_total, "sample_rate": SR, "mode": "final" if req.get("master") else "draft"}
    sfx = None
    if events:
        import accents  # sits next to this script; only needed when there are accent events

        bus, duck = float(req.get("accent_bus_db", -12.0)), float(req.get("accent_duck", 0.55))
        sfx = accents.accent_track(events, y, bus, duck)  # at the level it should have in the finished mix
        facts["accents"] = {"count": len(events), "bus_db": bus, "duck": duck}

    if not req.get("master"):
        mixed = y + sfx if sfx is not None else y
        if sfx is not None:
            peak = float(np.abs(mixed).max())
            facts["accents"]["sum_peak"] = round(peak, 4)
            if peak > 0.95:
                mixed = mixed * (0.95 / peak)
                facts["accents"]["scaled_by"] = round(0.95 / peak, 4)
        write16(out, mixed)
    else:
        m = req["master"]
        facts["target"] = m
        facts["mastering"] = master_complete(y, sfx, m, out, n_total)
    facts["measured"] = measure(out)
    json.dump(facts, sys.stdout)


if __name__ == "__main__":
    main()
