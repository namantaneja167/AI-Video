#!/usr/bin/env python3
"""Mouth opening per video frame from the real narration audio (run with .venv-qwen). The arithmetic is the prototype's
(scripts/pip_scene_timing.py): RMS over 45 ms, scaled by the 92nd percentile, smoothed (fast attack, slower release).

stdin JSON: {blocks: [{wav, offset_sec}], total_sec, fps}. stdout JSON: {mouth: [...]} one value (0..1) per frame."""
from __future__ import annotations

import json
import math
import sys

import numpy as np
from scipy.io import wavfile


def read_mono(path):
    sr, y = wavfile.read(path)
    y = y.astype(np.float32) / 32768 if y.dtype == np.int16 else y.astype(np.float32)
    return sr, (y.mean(axis=1) if y.ndim > 1 else y)


def raw_open(y, sr, fps):
    hop = int(sr / fps)
    win = int(0.045 * sr)
    n = int(len(y) / sr * fps)
    rms = np.array([np.sqrt((y[max(0, i * hop + hop // 2 - win // 2) : i * hop + hop // 2 + win // 2] ** 2).mean() + 1e-12) for i in range(n)])
    ref = np.percentile(rms, 92)
    return np.clip((rms - 0.06 * ref) / (0.9 * ref), 0, 1) ** 0.7


def mouth_track(blocks, total_sec, fps):
    n_frames = int(math.ceil(total_sec * fps))
    target = np.zeros(n_frames)
    for b in blocks:
        sr, y = read_mono(b["wav"])
        o = raw_open(y, sr, fps)
        start = int(round(b["offset_sec"] * fps))
        for k, v in enumerate(o):
            if 0 <= start + k < n_frames:
                target[start + k] = v
    mouth, m = np.zeros(n_frames), 0.0
    for fr in range(n_frames):
        tgt = target[fr]
        m += (tgt - m) * (0.65 if tgt > m else 0.35)
        mouth[fr] = m
    return [round(float(x), 3) for x in mouth]


if __name__ == "__main__":
    req = json.load(sys.stdin)
    json.dump({"mouth": mouth_track(req["blocks"], req["total_sec"], req.get("fps", 30))}, sys.stdout)
