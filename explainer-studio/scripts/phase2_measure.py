#!/usr/bin/env python3
"""Measure a produced MP4 and its mastered WAV against the configured targets (run with .venv-qwen).

  phase2_measure.py <final.mp4> <mastered.wav> <timeline.json> <out.json> <target_lufs> <target_tp_db>

Everything here is MEASURED from the files. Tolerances are stated in the output next to each result:
  mastered WAV   integrated loudness within +/-1.0 LU of target; true peak not above target + 0.2 dB
                 (loudnorm runs in one pass, which is approximate on short clips)
  decoded MP4    integrated loudness within +/-1.0 LU of target; true peak not above target + 0.5 dB
                 (lossy AAC encoding can add a few tenths of a dB of overshoot and a small loudness change)
  placement      every timeline segment start and end within 80 ms of the speech energy in the decoded MP4 audio
                 (energy threshold detection plus AAC delay, so this is a consistency check, not a ground truth)
  (Phase 3) with env PLACEMENT_WAV=<voice-only wav>, placement is measured on that file instead of the MP4 audio: a mix with sound
  accents has non-speech energy that the detector cannot tell from speech, so it needs the voice alone.
  global lag     cross-correlation lag between the decoded MP4 audio and the mastered WAV within 40 ms
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile

mp4, wav, timeline, out, T_LUFS, T_TP = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]), float(sys.argv[6])
TOL = {"lufs": 1.0, "wav_tp_over": 0.2, "mp4_tp_over": 0.5, "placement_ms": 80, "lag_ms": 40}


def run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{cmd[0]} failed: {r.stderr[-400:]}")
    return r.stderr + r.stdout


def ebur(path: str) -> dict:
    err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = err[err.rfind("Summary:"):]
    g = lambda pat: float(re.search(pat, tail).group(1))  # noqa: E731
    return {"integrated_lufs": g(r"I:\s+(-?[\d.]+) LUFS"), "loudness_range_lu": g(r"LRA:\s+(-?[\d.]+) LU"), "true_peak_dbtp": g(r"Peak:\s+(-?[\d.]+) dBFS")}


def probe(path: str) -> dict:
    j = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]))
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next(s for s in j["streams"] if s["codec_type"] == "audio")
    n, d = map(int, v["r_frame_rate"].split("/"))
    return {
        "container": j["format"]["format_name"], "duration_s": float(j["format"]["duration"]), "bytes": int(j["format"]["size"]),
        "video": {"codec": v["codec_name"], "width": v["width"], "height": v["height"], "fps": n / d, "pix_fmt": v.get("pix_fmt"), "frames": int(v.get("nb_frames", 0)), "duration_s": float(v["duration"])},
        "audio": {"codec": a["codec_name"], "sample_rate": int(a["sample_rate"]), "channels": a["channels"], "duration_s": float(a["duration"])},
    }


def load(path: str, sr: int = 24000) -> np.ndarray:
    with tempfile.TemporaryDirectory() as td:
        f = f"{td}/a.wav"
        run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), f])
        _, y = wavfile.read(f)
    return y.astype(np.float32) / 32768


def runs(y: np.ndarray, sr: int, rel_db: float = -40.0, min_gap: float = 0.12, min_run: float = 0.10, hop_s: float = 0.005):
    hop = int(hop_s * sr)
    env = np.array([np.sqrt((y[i : i + hop] ** 2).mean()) for i in range(0, len(y) - hop, hop)])
    act = env > env.max() * 10 ** (rel_db / 20)
    out_, i = [], 0
    while i < len(act):
        if act[i]:
            j = i
            while j < len(act) and act[j]:
                j += 1
            out_.append([i * hop_s, j * hop_s])
            i = j
        else:
            i += 1
    merged = [out_[0]]
    for a, b in out_[1:]:
        if a - merged[-1][1] < min_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [r for r in merged if r[1] - r[0] >= min_run]


def envelope(y: np.ndarray, sr: int, hop_s: float = 0.005) -> np.ndarray:
    hop = int(hop_s * sr)
    return np.array([np.sqrt((y[i : i + hop] ** 2).mean()) for i in range(0, len(y) - hop, hop)])


SR = 24000
ym, yw = load(mp4, SR), load(wav, SR)
tl = json.loads(Path(timeline).read_text())

# global lag between what is in the MP4 and the mastered WAV that went into it
em, ew = envelope(ym, SR), envelope(yw, SR)
n = min(len(em), len(ew))
em, ew = em[:n] - em[:n].mean(), ew[:n] - ew[:n].mean()
xc = np.correlate(em, ew, mode="full")
lag_ms = (int(np.argmax(xc)) - (n - 1)) * 5.0

# every timeline segment boundary against the speech energy in the decoded MP4 audio
import os
yp = load(os.environ["PLACEMENT_WAV"], SR) if os.environ.get("PLACEMENT_WAV") else ym
rr = runs(yp, SR)
placement = []
for s in tl["segments"]:
    a = min(rr, key=lambda r: abs(r[0] - s["start"]))
    b = min(rr, key=lambda r: abs(r[1] - s["end"]))
    placement.append({"segment": s["id"], "timeline_start": s["start"], "audio_start": round(a[0], 3), "start_error_ms": round((a[0] - s["start"]) * 1000), "timeline_end": s["end"], "audio_end": round(b[1], 3), "end_error_ms": round((b[1] - s["end"]) * 1000)})
worst = max(max(abs(p["start_error_ms"]), abs(p["end_error_ms"])) for p in placement)


def worst_at(rel_db):
    r2 = runs(yp, SR, rel_db)
    errs = []
    for sg in tl["segments"]:
        a = min(r2, key=lambda r: abs(r[0] - sg["start"]))
        b = min(r2, key=lambda r: abs(r[1] - sg["end"]))
        errs += [abs(a[0] - sg["start"]), abs(b[1] - sg["end"])]
    return round(max(errs) * 1000)

# Information only (the pass flag below stays at -40 dB): how far the detector's answer depends on its threshold.
sweep = {str(db): worst_at(float(db)) for db in (-30, -35, -40, -45, -50)}

m_wav, m_mp4 = ebur(wav), ebur(mp4)
info = probe(mp4)
res = {
    "targets": {"lufs": T_LUFS, "true_peak_dbtp": T_TP}, "tolerances": TOL,
    "mastered_wav": {**m_wav, "loudness_error_lu": round(m_wav["integrated_lufs"] - T_LUFS, 2), "pass": abs(m_wav["integrated_lufs"] - T_LUFS) <= TOL["lufs"] and m_wav["true_peak_dbtp"] <= T_TP + TOL["wav_tp_over"]},
    "decoded_mp4_audio": {**m_mp4, "loudness_error_lu": round(m_mp4["integrated_lufs"] - T_LUFS, 2), "pass": abs(m_mp4["integrated_lufs"] - T_LUFS) <= TOL["lufs"] and m_mp4["true_peak_dbtp"] <= T_TP + TOL["mp4_tp_over"]},
    "mp4": info,
    "timeline_duration_s": tl["durationSec"], "duration_difference_ms": round((info["duration_s"] - tl["durationSec"]) * 1000),
    "global_lag_ms": lag_ms, "lag_pass": abs(lag_ms) <= TOL["lag_ms"],
    "placement_measured_on": "voice-only mix" if os.environ.get("PLACEMENT_WAV") else "decoded mp4 audio", "placement": placement, "placement_worst_ms_by_threshold_db": sweep, "placement_worst_ms": worst, "placement_pass": worst <= TOL["placement_ms"],
}
Path(out).write_text(json.dumps(res, indent=2))
print(json.dumps({k: res[k] for k in ("mastered_wav", "decoded_mp4_audio", "global_lag_ms", "placement_worst_ms", "duration_difference_ms")}, indent=1))
