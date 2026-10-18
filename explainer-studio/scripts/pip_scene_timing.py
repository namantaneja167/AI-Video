#!/usr/bin/env python3
"""Derive scene timing from the REAL narration audio, synthesise restrained sound accents, and mix the scene audio.

Run with .venv-qwen after scripts/pip_scene_narration.py. Inputs: audio/pip-scene-10x/takes/narration_seed<N>.wav.
Outputs: audio/pip-scene-10x/{narration_mastered.wav,scene_mix.wav,timing.json} and a copy of timing.json + scene_mix.wav in public/scenes/pip-10x/.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
TAKES = ROOT / "audio" / "pip-scene-10x" / "takes"
OUT = ROOT / "audio" / "pip-scene-10x"
PUB = ROOT / "public" / "scenes" / "pip-10x"
FPS = 30
SR = 48000
LEAD = 1.0  # scene seconds before the first spoken sample (card reveal)
TAIL = 3.6  # hold after the last spoken sample

# (id, text, syllables). The comma pause inside the last sentence is a real gap in the audio, so it is its own segment.
SEGS = [
    ("s1", "Ten times faster.", 4),
    ("s2", "Sounds impressive.", 4),
    ("s3", "But faster at what?", 5),
    ("s4", "This test used tiny prompts.", 6),
    ("s5", "A long document is a different workload.", 12),
    ("s6a", "Before trusting the headline,", 7),
    ("s6b", "check what was measured.", 5),
]
WORD_SYL = {  # per-word syllables, used only to estimate word times inside a segment
    "Ten": 1, "times": 1, "faster": 2, "Sounds": 1, "impressive": 3, "But": 1, "at": 1, "what": 1, "This": 1, "test": 1, "used": 1, "tiny": 2,
    "prompts": 1, "A": 1, "long": 1, "document": 3, "is": 1, "a": 1, "different": 3, "workload": 2, "Before": 2, "trusting": 2, "the": 1,
    "headline": 2, "check": 1, "was": 1, "measured": 2,
}


def run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{' '.join(cmd[:3])} failed: {r.stderr[-400:]}")
    return r.stderr + r.stdout


def speech_runs(y: np.ndarray, sr: int, rel_db: float = -40.0, min_gap: float = 0.12, min_run: float = 0.10):
    hop = int(0.005 * sr)
    env = np.array([np.sqrt((y[i:i + hop] ** 2).mean()) for i in range(0, len(y) - hop, hop)])
    act = env > env.max() * 10 ** (rel_db / 20)
    runs, i, n = [], 0, len(act)
    while i < n:
        if act[i]:
            j = i
            while j < n and act[j]:
                j += 1
            runs.append([i * 0.005, j * 0.005])
            i = j
        else:
            i += 1
    merged = [runs[0]]  # close silent gaps shorter than min_gap
    for a, b in runs[1:]:
        if a - merged[-1][1] < min_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [r for r in merged if r[1] - r[0] >= min_run]


def master(raw: Path, dst: Path) -> None:
    run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", "loudnorm=I=-16:TP=-2:LRA=11", "-ar", str(SR), "-ac", "1", str(dst)])


def load48(p: Path) -> np.ndarray:
    sr, y = wavfile.read(p)
    assert sr == SR
    return y.astype(np.float32) / 32768


# ------------------------------------------------------------------ sound accents (soft, short, synthesised)
def _env(n, atk=0.004, dec=0.08):
    t = np.arange(n) / SR
    return np.minimum(1, t / atk) * np.exp(-t / dec)


def pop(f=560, dur=0.11, g=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f * (1.0 - 0.35 * t / dur)) / SR
    return g * np.sin(ph) * _env(n, 0.003, 0.035)


def ding(f=880, dur=0.7, g=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    return g * (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.08)) * _env(n, 0.004, 0.16)


def chime(freqs=(587.0, 740.0), dur=0.9, g=1.0):
    n = int(dur * SR); out = np.zeros(n)
    for k, f in enumerate(freqs):
        d = int(k * 0.07 * SR)
        seg = ding(f, dur - k * 0.07, 1.0)
        out[d:] += seg[: n - d]
    return g * out / len(freqs)


def thump(dur=0.28, g=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 78 * np.exp(-t / 0.09) + 42
    return g * np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(n, 0.004, 0.07)


def tick(g=1.0, f=2100):
    n = int(0.03 * SR); t = np.arange(n) / SR
    return g * np.sin(2 * np.pi * f * t) * np.exp(-t / 0.004)


def whoosh(dur=0.42, up=True, g=1.0, seed=3):
    n = int(dur * SR); rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    b, a = signal.butter(2, [500 / (SR / 2), 3800 / (SR / 2)], btype="band")
    x = signal.lfilter(b, a, noise)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * t) ** 2
    if not up:
        env = env[::-1] * 0 + env
    return g * x / (np.abs(x).max() + 1e-9) * env


def swish(dur=0.55, g=1.0, seed=5):
    return whoosh(dur, True, g, seed) * np.linspace(0.3, 1.0, int(dur * SR))


def main() -> None:
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 11
    raw = TAKES / f"narration_seed{seed}.wav"
    sr0, y0 = wavfile.read(raw)
    y0 = y0.astype(np.float32) / 32768
    narr_dur = len(y0) / sr0

    runs = speech_runs(y0, sr0)
    if len(runs) != len(SEGS):
        raise SystemExit(f"expected {len(SEGS)} speech segments, found {len(runs)}: {[(round(a, 2), round(b, 2)) for a, b in runs]}")
    syl = np.array([s[2] for s in SEGS], dtype=float)
    dur = np.array([b - a for a, b in runs])
    rate = dur / syl
    med = float(np.median(rate))
    check = [{"id": s[0], "syllables": s[2], "seconds": round(float(d), 2), "sec_per_syllable": round(float(r), 3), "vs_median": round(float(r / med), 2)} for s, d, r in zip(SEGS, dur, rate)]
    bad = [c["id"] for c in check if not (0.55 <= c["vs_median"] <= 1.7)]

    seg = {}
    for (sid, text, _), (a, b) in zip(SEGS, runs):
        seg[sid] = {"id": sid, "text": text, "start": round(a + LEAD, 3), "end": round(b + LEAD, 3)}

    words = []
    for sid, text, _ in SEGS:
        toks = re.findall(r"[A-Za-z']+", text)
        w = np.array([WORD_SYL[t] for t in toks], dtype=float)
        a, b = seg[sid]["start"], seg[sid]["end"]
        edges = a + (b - a) * np.concatenate([[0], np.cumsum(w) / w.sum()])
        for t, e0, e1 in zip(toks, edges[:-1], edges[1:]):
            words.append({"text": t, "segment": sid, "start": round(float(e0), 3), "end": round(float(e1), 3)})

    def word(sid: str, text: str) -> dict:
        return next(w for w in words if w["segment"] == sid and w["text"] == text)

    s = seg
    cues = {
        "card_in": 0.05,
        "claim": round(s["s1"]["start"] - 0.08, 3),
        "sub": round(word("s1", "faster")["start"], 3),
        "bars": round(s["s2"]["start"], 3),
        "notice": round(s["s3"]["start"] - 0.05, 3),
        "asterisk_pulse": round(word("s3", "faster")["start"], 3),
        "point": round(word("s3", "at")["start"] - 0.12, 3),
        "callout": round(s["s4"]["start"] - 0.05, 3),
        "callout_text": round(word("s4", "tiny")["start"] - 0.05, 3),
        "point_release": round(s["s4"]["start"] + 0.95, 3),
        "contrast": round(s["s5"]["start"] - 0.05, 3),
        "lane_long": round(word("s5", "long")["start"] - 0.05, 3),
        "palms": round(word("s5", "different")["start"] - 0.18, 3),
        "contrast_out": round(s["s6a"]["start"] + 0.1, 3),
        "face_camera": round(s["s6a"]["start"], 3),
        "resolve1": round(s["s6b"]["start"] - 0.05, 3),
        "resolve2": round(s["s6b"]["end"] - 0.42, 3),
        "voice_end": round(s["s6b"]["end"], 3),
    }

    # phrase captions: exact where the audio has a gap, syllable-estimated inside s5 (A long document | is a different workload.)
    s5a = word("s5", "document")["end"]
    phrases = [
        {"id": "p1", "text": "Ten times faster.", "start": s["s1"]["start"], "end": s["s1"]["end"], "exact": True},
        {"id": "p2", "text": "Sounds impressive.", "start": s["s2"]["start"], "end": s["s2"]["end"], "exact": True},
        {"id": "p3", "text": "But faster at what?", "start": s["s3"]["start"], "end": s["s3"]["end"], "exact": True},
        {"id": "p4", "text": "This test used tiny prompts.", "start": s["s4"]["start"], "end": s["s4"]["end"], "exact": True},
        {"id": "p5a", "text": "A long document", "start": s["s5"]["start"], "end": round(s5a, 3), "exact": False},
        {"id": "p5b", "text": "is a different workload.", "start": round(s5a, 3), "end": s["s5"]["end"], "exact": False},
        {"id": "p6a", "text": "Before trusting the headline,", "start": s["s6a"]["start"], "end": s["s6a"]["end"], "exact": True},
        {"id": "p6b", "text": "check what was measured.", "start": s["s6b"]["start"], "end": s["s6b"]["end"], "exact": True},
    ]

    total = LEAD + narr_dur + TAIL
    n_frames = int(np.ceil(total * FPS))

    # mouth opening (0..1) per frame from the real audio envelope, smoothed (fast attack, slower release)
    hop = int(sr0 / FPS)
    win = int(0.045 * sr0)
    rms = np.array([np.sqrt((y0[max(0, i * hop + hop // 2 - win // 2): i * hop + hop // 2 + win // 2] ** 2).mean() + 1e-12) for i in range(int(narr_dur * FPS))])
    ref = np.percentile(rms, 92)
    raw_open = np.clip((rms - 0.06 * ref) / (0.9 * ref), 0, 1) ** 0.7
    mouth = np.zeros(n_frames)
    m = 0.0
    for fr in range(n_frames):
        k = fr - int(round(LEAD * FPS))
        tgt = raw_open[k] if 0 <= k < len(raw_open) else 0.0
        m += (tgt - m) * (0.65 if tgt > m else 0.35)
        mouth[fr] = m

    # ------------------------------------------------------------- audio: master voice, then accents, then mix
    OUT.mkdir(parents=True, exist_ok=True)
    mastered = OUT / "narration_mastered_voice_only.wav"
    master(raw, mastered)
    v = load48(mastered)
    n_total = int(total * SR)
    voice = np.zeros(n_total, dtype=np.float32)
    off = int(LEAD * SR)
    voice[off: off + len(v)] = v[: n_total - off]

    venv_hop = int(0.02 * SR)
    venv = np.array([np.sqrt((voice[i:i + venv_hop] ** 2).mean()) for i in range(0, n_total, venv_hop)])
    venv = venv / (np.percentile(venv, 95) + 1e-9)
    duck = 1.0 - 0.55 * np.clip(np.interp(np.arange(n_total) / venv_hop, np.arange(len(venv)), venv), 0, 1)

    sfx_events = [
        ("card_in", cues["card_in"], pop(430, 0.14, 0.50)),
        ("claim", cues["claim"], pop(640, 0.12, 0.55)),
        ("bars", cues["bars"], swish(0.55, 0.38)),
        ("asterisk", cues["asterisk_pulse"], ding(988, 0.7, 0.40)),
        ("point", cues["point"] + 0.30, tick(0.55)),
        ("callout", cues["callout"], whoosh(0.34, True, 0.42)),
        ("callout_land", cues["callout"] + 0.30, pop(520, 0.12, 0.45)),
        ("contrast", cues["contrast"], whoosh(0.30, True, 0.34, 9)),
        ("lane_long", cues["lane_long"], pop(470, 0.1, 0.38)),
        ("resolve1", cues["resolve1"], thump(0.3, 0.60)),
        ("resolve2", cues["resolve2"], chime((587.0, 740.0), 1.0, 0.45)),
    ]
    for i in range(7):  # sparse token ticks while the lanes stream
        sfx_events.append((f"token{i}", cues["contrast"] + 0.35 + i * 0.22, tick(0.30, 1700 + 120 * (i % 3))))
    sfx = np.zeros(n_total, dtype=np.float32)
    placed = []
    for name, t, w in sfx_events:
        i0 = int(t * SR)
        w = w.astype(np.float32)
        end = min(n_total, i0 + len(w))
        sfx[i0:end] += w[: end - i0]
        placed.append({"t": round(float(t), 3), "name": name})
    sfx *= duck.astype(np.float32) * 0.25  # beneath the voice
    mix = voice + sfx
    peak = float(np.abs(mix).max())
    if peak > 0.89:  # keep true-peak headroom
        mix *= 0.89 / peak
    wavfile.write(OUT / "scene_mix.wav", SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
    wavfile.write(OUT / "scene_voice_only.wav", SR, (np.clip(voice, -1, 1) * 32767).astype(np.int16))
    wavfile.write(OUT / "scene_sfx_only.wav", SR, (np.clip(sfx, -1, 1) * 32767).astype(np.int16))

    timing = {
        "fps": FPS, "durationSec": round(n_frames / FPS, 3), "frames": n_frames, "leadSec": LEAD, "tailSec": TAIL, "narrationSeed": seed,
        "narrationDurationSec": round(narr_dur, 3), "audio": "scene_mix.wav", "segments": list(seg.values()), "words": words, "wordsEstimated": True,
        "phrases": phrases, "cues": cues, "sfx": placed, "mouth": [round(float(x), 3) for x in mouth], "segmentCheck": check, "segmentCheckFlags": bad,
    }
    OUT.joinpath("timing.json").write_text(json.dumps(timing, indent=2))
    PUB.mkdir(parents=True, exist_ok=True)
    PUB.joinpath("timing.json").write_text(json.dumps(timing))
    for name in ("scene_mix.wav",):
        (PUB / name).write_bytes((OUT / name).read_bytes())
    print(json.dumps({"duration": timing["durationSec"], "frames": n_frames, "segments": {k: (v["start"], v["end"]) for k, v in seg.items()}, "cues": cues,
                      "segment_rate_check": check, "flags": bad, "sfx_events": len(placed)}, indent=1))


if __name__ == "__main__":
    main()
