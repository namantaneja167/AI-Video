#!/usr/bin/env python3
"""Phase 2 alignment evaluation, analysis (run with .venv-qwen after scripts/phase2_align_eval.ts).

Reference boundaries: an INDEPENDENT acoustic measure, not human labels. Every segment (sentence or clause) in the Pip
takes is separated from its neighbours by real silence, so each segment's first and last sample of speech is measurable
from the energy envelope. The aligner's and the estimator's segment starts/ends are compared with those. The threshold
is varied (-35/-40/-45 dB below the loudest frame) so the reference's own uncertainty is visible.

Word boundaries INSIDE sentences cannot be measured this way. For those, annotated spectrograms are written as PNG
(aligner = red, estimate = blue, speech runs = green) for judging by eye. That is a visual judgement, not a measurement.
"""
from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "out/phase2/align-eval")
R = json.loads((OUT / "results.json").read_text())


def runs(y: np.ndarray, sr: int, rel_db: float, min_gap: float = 0.12, min_run: float = 0.10, hop_s: float = 0.005):
    hop = int(hop_s * sr)
    env = np.array([np.sqrt((y[i : i + hop] ** 2).mean()) for i in range(0, len(y) - hop, hop)])
    act = env > env.max() * 10 ** (rel_db / 20)
    out, i, n = [], 0, len(act)
    while i < n:
        if act[i]:
            j = i
            while j < n and act[j]:
                j += 1
            out.append([i * hop_s, j * hop_s])
            i = j
        else:
            i += 1
    merged = [out[0]]
    for a, b in out[1:]:
        if a - merged[-1][1] < min_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [r for r in merged if r[1] - r[0] >= min_run]


def load(p: str):
    sr, y = wavfile.read(p)
    return sr, (y.astype(np.float32) / 32768 if y.dtype == np.int16 else y.astype(np.float32))


def stats(errs):
    a = np.abs(np.array(errs))
    return {"n": int(len(a)), "mean_abs_ms": round(float(a.mean() * 1000)), "median_abs_ms": round(float(np.median(a) * 1000)), "max_abs_ms": round(float(a.max() * 1000)), "mean_signed_ms": round(float(np.mean(errs) * 1000))}


report: dict = {"reference": "energy-envelope speech runs (independent acoustic measure, not human labels)", "note": "the estimator derives segment spans from the same silence runs, so it is NOT compared at segment level (circular); it is compared at word level against hand-marked onsets", "takes": {}}
for name, t in R["takes"].items():
    sr, y = load(t["wav"])
    n_seg = len(t["aligned"]["segments"])
    per_thr = {}
    for thr in (-35, -40, -45):
        rr = None
        for gap in (0.12, 0.08, 0.06):
            cand = runs(y, sr, thr, min_gap=gap)
            segs_ = t["aligned"]["segments"]
            # a pairing is trusted only if every start and end agrees within 0.35 s (the aligner works on an 80 ms grid);
            # a bigger disagreement means the two methods segment the take differently, which needs a look, not an average
            paired = len(cand) == n_seg and all(abs(a[0] - s_["start"]) < 0.35 and abs(a[1] - s_["end"]) < 0.35 for a, s_ in zip(cand, segs_))
            if paired:
                rr, used = cand, gap
                break
        if rr is None:
            per_thr[str(thr)] = {"error": f"the energy envelope does not give speech runs that agree with the {n_seg} segments within 0.35 s at any silence setting tried (two methods segment this take differently); no automatic reference. Checked by eye instead"}
            continue
        segs = t["aligned"]["segments"]
        st = [s["start"] - r[0] for s, r in zip(segs, rr)]
        en = [s["end"] - r[1] for s, r in zip(segs, rr)]
        per_thr[str(thr)] = {"min_gap_s": used, "aligned": {"start": stats(st), "end": stats(en), "all": stats(st + en)}}
    report["takes"][name] = per_thr
(OUT / "report.json").write_text(json.dumps(report, indent=2))


# ---------------------------------------------------------------- annotated spectrograms (PNG, no plotting library)
def png(path: Path, rgb: np.ndarray) -> None:
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))
    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


FONT = {"0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001", "5": "111100111001111",
        "6": "111100111101111", "7": "111001001001001", "8": "111101111101111", "9": "111101111001111", ".": "000000000000010"}


def digits(img, x: int, y: int, text: str, scale: int = 2) -> None:
    for ch in text:
        g = FONT[ch]
        for r in range(5):
            for c in range(3):
                if g[r * 3 + c] == "1":
                    img[y + r * scale : y + (r + 1) * scale, x + c * scale : x + (c + 1) * scale] = (255, 255, 255)
        x += 4 * scale


def render(name: str, t0: float, t1: float, px_per_s: int = 320) -> None:
    t = R["takes"][name]
    sr, y = load(t["wav"])
    nper, hopn = int(0.012 * sr), int(0.0025 * sr)  # wideband: shows word and syllable edges rather than pitch harmonics
    f, tt, S = signal.spectrogram(y, sr, nperseg=nper, noverlap=nper - hopn, scaling="spectrum")
    keep = f <= 6000
    D = 10 * np.log10(S[keep] + 1e-10)
    D = np.clip((D - (D.max() - 60)) / 60, 0, 1)[::-1]
    W, H = int((t1 - t0) * px_per_s), 260
    img = np.zeros((H + 40, W, 3), dtype=np.uint8)
    rows = np.linspace(0, D.shape[0] - 1, H).astype(int)
    xs = t0 + (np.arange(W) + 0.5) / px_per_s
    idx = np.clip(np.searchsorted(tt, xs), 0, len(tt) - 1)
    g = (D[rows][:, idx] * 255).astype(np.uint8)
    img[:H] = np.stack([g, g, g], axis=2)
    for a, b in runs(y, sr, -40):  # green bar: where the energy says there is speech
        x0, x1 = int((max(a, t0) - t0) * px_per_s), int((min(b, t1) - t0) * px_per_s)
        if x1 > x0:
            img[H + 4 : H + 12, x0:x1] = (60, 200, 90)
    for tick in np.arange(np.ceil(t0 * 10) / 10, t1, 0.1):  # grid: every 0.1 s faint, every 0.5 s strong with a label
        x = int((tick - t0) * px_per_s)
        whole = abs(tick * 2 - round(tick * 2)) < 1e-6
        if whole:
            img[:H:4, x] = (255, 255, 0)
        img[H + 14 : H + (30 if whole else 20), x] = (255, 255, 255)
        if whole:
            digits(img, x + 3, H + 14, f"{tick:g}")
    for method, color, y0, y1 in (("aligned", (255, 60, 60), 0, H // 2), ("estimated", (80, 140, 255), H // 2, H)):
        for s in t[method]["segments"]:
            for w in s["words"]:
                for edge in (w["start"],):
                    if t0 <= edge < t1:
                        x = int((edge - t0) * px_per_s)
                        img[y0:y1, x] = color
    png(OUT / f"spec_{name}_{int(t0):02d}-{int(t1):02d}s.png", img)


for name in R["takes"]:
    for a in range(0, 12, 2):
        render(name, a, a + 2, px_per_s=640)
print(json.dumps(report, indent=2))


# ---------------------------------------------------------------- word onsets vs hand marks
def compare_marks() -> dict:
    marks = json.loads(Path("tests/fixtures/alignment/seed11-hand-marks.json").read_text())["marks"]
    t = R["takes"]["seed11"]
    out: dict = {"marks": len(marks)}
    for method in ("aligned", "estimated"):
        words = [w for s in t[method]["segments"] for w in s["words"]]
        used, errs = 0, []
        for m in marks:
            cand = [w for w in words[used:] if w["text"].strip(".,?!").lower() == m["word"].lower()]
            if not cand:
                continue
            w = cand[0]
            used = words.index(w) + 1
            errs.append((m, w["start"] - m["t"]))
        def pack(sel):
            e = [x for _, x in sel]
            return {"n": len(e), "mean_abs_ms": round(1000 * float(np.mean(np.abs(e)))), "max_abs_ms": round(1000 * float(np.max(np.abs(e)))), "mean_signed_ms": round(1000 * float(np.mean(e)))}
        out[method] = {"all": pack(errs), "interior_words_only": pack([(m, x) for m, x in errs if not m.get("sentenceInitial")])}
    return out


if "seed11" in R["takes"]:
    marks_report = compare_marks()
    report["handMarks"] = marks_report
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(marks_report, indent=2))
