"""Synthesized sound accents (run with .venv-qwen): the prototype's seven sounds, moved here from scripts/pip_scene_timing.py
(same arithmetic; tests compare the result with the prototype's own accent track). No assets, no downloads."""
from __future__ import annotations

import numpy as np
from scipy import signal

SR = 48000


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


def render(accent: str, gain_db: float, params: dict) -> np.ndarray:
    g = 10 ** (gain_db / 20)
    p = dict(params or {})
    if accent == "pop":
        return pop(g=g, **p)
    if accent == "ding":
        return ding(g=g, **p)
    if accent == "chime":
        if "freqs" in p:
            p["freqs"] = tuple(p["freqs"])
        return chime(g=g, **p)
    if accent == "thump":
        return thump(g=g, **p)
    if accent == "tick":
        return tick(g=g, **p)
    if accent == "whoosh":
        return whoosh(g=g, **p)
    if accent == "swish":
        return swish(g=g, **p)
    raise ValueError(f"unknown accent {accent!r}")


def accent_track(events: list[dict], voice: np.ndarray, bus_db: float, duck: float) -> np.ndarray:
    """Place accents at their times, duck them under the voice, apply the bus gain. `events`: [{accent, t, gain_db, params}]."""
    n_total = len(voice)
    sfx = np.zeros(n_total, dtype=np.float32)
    for e in events:
        w = render(e["accent"], e["gain_db"], e.get("params") or {}).astype(np.float32)
        i0 = int(e["t"] * SR)
        end = min(n_total, i0 + len(w))
        if end > i0:
            sfx[i0:end] += w[: end - i0]
    hop = int(0.02 * SR)
    venv = np.array([np.sqrt((voice[i : i + hop] ** 2).mean()) for i in range(0, n_total, hop)])
    venv = venv / (np.percentile(venv, 95) + 1e-9)
    ducking = 1.0 - duck * np.clip(np.interp(np.arange(n_total) / hop, np.arange(len(venv)), venv), 0, 1)
    return sfx * ducking.astype(np.float32) * (10 ** (bus_db / 20))
