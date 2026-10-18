#!/usr/bin/env python3
"""Where does a segment's speech end? Compares the aligner's word times with the energy in the voice-only audio around chosen
boundaries, across detector thresholds, and writes spectrograms with the boundaries marked. Measurement only: nothing is shifted.

  .venv-qwen/bin/python scripts/phase3_boundary.py <timeline.json> <voice-only.wav> <out-dir> [segment ...]

Prints, for each requested segment end and start: the aligner time, the last/first word, and the time where the 5 ms RMS envelope
crosses -30 ... -60 dB (relative to the file's maximum, as scripts/phase2_measure.py does) and relative to the segment's own peak.
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile

SR = 24000
tl = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
want = sys.argv[4:] or [s["id"] for s in tl["segments"]]

def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768

y = load(sys.argv[2])
hop = int(0.005 * SR)
env = np.array([np.sqrt((y[i:i + hop] ** 2).mean() + 1e-14) for i in range(0, len(y) - hop, hop)])
db_global = 20 * np.log10(env / env.max())
LEVELS = [-30, -35, -40, -45, -50, -55, -60]

def cross_out(t0, level, db, lo, hi):
    """First time after t0-0.3 where the envelope stays below `level` for 120 ms (the detector merges gaps shorter than that)."""
    i0 = int(max(lo, t0 - 0.3) / 0.005)
    for i in range(i0, int(hi / 0.005)):
        if i + 24 < len(db) and (db[i:i + 24] < level).all():
            return round(i * 0.005, 3)
    return None

def cross_in(t0, level, db, lo, hi):
    for i in range(int(max(lo, 0) / 0.005), int(min(len(db) * 0.005, t0 + 0.3) / 0.005)):
        if db[i] >= level and i * 0.005 >= t0 - 0.3:
            return round(i * 0.005, 3)
    return None

rows = []
for k, s in enumerate(tl["segments"]):
    if s["id"] not in want:
        continue
    seg_peak = env[int(s["start"] / 0.005):int(s["end"] / 0.005) + 1].max()
    db_seg = 20 * np.log10(env / seg_peak)
    nxt = tl["segments"][k + 1]["start"] if k + 1 < len(tl["segments"]) else len(y) / SR
    prv = tl["segments"][k - 1]["end"] if k else 0.0
    end = {lv: cross_out(s["end"], lv, db_global, s["start"], nxt) for lv in LEVELS}
    start = {lv: cross_in(s["start"], lv, db_global, prv, s["end"]) for lv in LEVELS}
    rows.append({"segment": s["id"], "first_word": s["words"][0]["text"], "last_word": s["words"][-1]["text"], "aligner_start": s["start"], "aligner_end": s["end"],
                 "last_word_start": s["words"][-1]["start"], "end_at_level_global": end, "start_at_level_global": start,
                 "end_error_ms_at": {lv: (None if v is None else round((v - s["end"]) * 1000)) for lv, v in end.items()},
                 "start_error_ms_at": {lv: (None if v is None else round((v - s["start"]) * 1000)) for lv, v in start.items()},
                 "level_at_aligner_end_db_global": round(float(db_global[int(s["end"] / 0.005)]), 1),
                 "level_at_aligner_end_db_of_segment_peak": round(float(db_seg[int(s["end"] / 0.005)]), 1), "next_start": nxt})
json.dump(rows, open(out / "boundary-sweep.json", "w"), indent=1)
print(f"{'seg':5s}{'edge':7s}{'aligner':>9s}" + "".join(f"{lv:>8d}" for lv in LEVELS) + "   (error in ms of the detector's boundary at each threshold dB re file max)")
for r in rows:
    print(f"{r['segment']:5s}{'start':7s}{r['aligner_start']:9.3f}" + "".join(f"{(v if v is not None else float('nan')):8.0f}" for v in r["start_error_ms_at"].values()))
    print(f"{'':5s}{'end':7s}{r['aligner_end']:9.3f}" + "".join(f"{(v if v is not None else float('nan')):8.0f}" for v in r["end_error_ms_at"].values()) + f"   last word '{r['last_word']}' starts {r['last_word_start']}; level at aligner end {r['level_at_aligner_end_db_global']} dB (file) / {r['level_at_aligner_end_db_of_segment_peak']} dB (segment peak)")
