#!/usr/bin/env python3
"""Pip voice auditions: the same script read three ways with local Kokoro, then measured.

Each audition is one continuous synthesis (Kokoro is weak on very short utterances), after which the natural gaps at chosen
boundaries are replaced by exact silences, cutting at the quietest point of each gap. Outputs go to audio/pip-voice-auditions/.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.narration import SAMPLE_RATE, _group_words, audio_duration, finish_audio, run  # noqa: E402

OUT = ROOT / "audio" / "pip-voice-auditions"

SCRIPT = (
    "Ten times faster. Sounds impressive. But faster at what? An AI tool might answer a short question quickly, then slow down when you give it "
    "a long document. Before comparing the headline numbers, check the task, the hardware, and how speed was measured. "
    "The useful question is: will it make your work faster?"
)

# Chunk boundaries where pauses are controlled. Word counts sum to the 53 words of SCRIPT.
CHUNKS = [
    ("Ten times faster.", 3),
    ("Sounds impressive.", 2),
    ("But faster at what?", 4),
    ("An AI tool might answer a short question quickly,", 9),
    ("then slow down when you give it a long document.", 10),
    ("Before comparing the headline numbers, check the task, the hardware, and how speed was measured.", 15),
    ("The useful question is:", 4),
    ("will it make your work faster?", 6),
]

# Pause (seconds) after each chunk; None keeps Kokoro's own gap.
#                          after: 1     2     3     4     5     6     7
AUDITIONS = {
    "A": {
        "name": "friendly_curious",
        "title": "Friendly, curious explainer",
        "voice": "af_heart",
        "speed": 1.0,
        "pauses": [0.40, 0.30, 0.80, None, 0.45, 0.65, None],
    },
    "B": {
        "name": "playful_skeptic",
        "title": "Playful skeptic, restrained dry humour",
        "voice": "af_bella,am_michael",
        "speed": 1.04,
        "pauses": [0.50, 0.70, 0.90, 0.35, 0.40, 0.60, 0.30],
    },
    "C": {
        "name": "calm_analyst",
        "title": "Calm, confident analyst",
        "voice": "am_michael",
        "speed": 0.95,
        "pauses": [0.45, 0.40, 0.75, None, 0.55, 0.70, 0.25],
    },
}
LEAD, TAIL, FADE = 0.25, 0.7, 0.006


def f0_stats(y: np.ndarray, sr: int) -> dict:
    hop, size = int(0.01 * sr), int(0.04 * sr)
    lo, hi = int(sr / 400), int(sr / 70)
    gate = 0.06 * np.abs(y).max() * 0.35
    f0 = []
    for i in range(0, len(y) - size, hop):
        fr = y[i:i + size] * np.hanning(size)
        if np.sqrt((fr**2).mean()) < gate:
            continue
        spec = np.fft.rfft(fr, 2 * size)
        ac = np.fft.irfft(spec * np.conj(spec))[: hi + 1]
        ac = ac / (ac[0] + 1e-9)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.5:
            f0.append(sr / k)
    a = np.array(f0)
    return {"median_hz": round(float(np.median(a)), 1), "p10_hz": round(float(np.percentile(a, 10)), 1), "p90_hz": round(float(np.percentile(a, 90)), 1), "voiced_frames": int(len(a))}


def synthesize(pipe, voice: str, speed: float) -> tuple[np.ndarray, list[dict]]:
    parts, words, off = [], [], 0.0
    for r in pipe(SCRIPT, voice=voice, speed=speed, split_pattern=None):
        a = r.audio.detach().cpu().numpy().astype(np.float32)
        words += _group_words(r.tokens or [], off)
        parts.append(a)
        off += len(a) / SAMPLE_RATE
    return np.concatenate(parts), words


def silences(y: np.ndarray, sr: int, min_len: float = 0.12, rel_db: float = -42.0) -> list[tuple[float, float]]:
    """Silent runs (start, end) in seconds, found from the audio itself (Kokoro word timestamps are not reliable)."""
    hop = int(0.005 * sr)
    env = np.array([np.sqrt((y[i:i + hop] ** 2).mean()) for i in range(0, len(y) - hop, hop)])
    quiet = env < env.max() * 10 ** (rel_db / 20)
    runs, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            if (j - i) * 0.005 >= min_len:
                runs.append((i * 0.005, j * 0.005))
            i = j
        else:
            i += 1
    return runs


KEEP = 0.03  # natural silence kept on each side of a replaced gap


def assemble(y: np.ndarray, words: list[dict], pauses: list[float | None]) -> tuple[np.ndarray, list[dict]]:
    """Replace the natural gap at each controlled boundary with an exact pause. Returns (audio, inserted pauses in output time)."""
    sr = SAMPLE_RATE
    n_words = sum(n for _, n in CHUNKS)
    if len(words) != n_words:
        raise SystemExit(f"expected {n_words} words from the voice, got {len(words)}: {[w['text'] for w in words]}")
    sil = [(a, b) for a, b in silences(y, sr) if a > 0.05 and b < len(y) / sr - 0.05]
    ends, i = [], -1
    for _, n in CHUNKS:
        i += n
        ends.append(i)
    chosen, used = [], set()
    for k, p in enumerate(pauses):
        if p is None:
            continue
        est = (words[ends[k]]["end"] + words[ends[k] + 1]["start"]) / 2
        best = min(((0.0 if a <= est <= b else min(abs(a - est), abs(b - est))), idx) for idx, (a, b) in enumerate(sil) if idx not in used)
        if best[0] > 0.8:
            raise SystemExit(f"no silence near boundary {k} (est {est:.2f}s); silences: {sil}")
        used.add(best[1])
        chosen.append((sil[best[1]], p, CHUNKS[k][0]))
    chosen.sort(key=lambda c: c[0][0])
    out, pos, t_out, applied = [np.zeros(int(LEAD * sr), dtype=np.float32)], 0.0, LEAD, []
    f = int(FADE * sr)
    for (s0, s1), p, label in chosen:
        end = s0 + KEEP
        seg = y[int(pos * sr): int(end * sr)].copy()
        if pos > 0:
            seg[:f] *= np.linspace(0, 1, f)
        seg[-f:] *= np.linspace(1, 0, f)
        out.append(seg)
        t_out += len(seg) / sr
        gap = max(0.0, p - 2 * KEEP)
        out.append(np.zeros(int(gap * sr), dtype=np.float32))
        applied.append({"after": label, "natural_silence_s": round(s1 - s0, 2), "inserted_s": round(gap + 2 * KEEP, 2), "starts_at_s": round(t_out - KEEP, 2)})
        t_out += gap
        pos = s1 - KEEP
    seg = y[int(pos * sr):].copy()
    seg[:f] *= np.linspace(0, 1, f)
    out.append(seg)
    out.append(np.zeros(int(TAIL * sr), dtype=np.float32))
    return np.concatenate(out), applied


def lufs(path: Path) -> dict:
    txt = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = txt[txt.rfind("Summary"):]
    g = lambda pat: float(re.search(pat, tail).group(1))  # noqa: E731
    return {"integrated_lufs": g(r"I:\s+(-?[\d.]+) LUFS"), "loudness_range_lu": g(r"LRA:\s+(-?[\d.]+) LU"), "true_peak_dbtp": g(r"Peak:\s+(-?[\d.]+) dBFS")}


def verify(path: Path) -> dict:
    """Re-read the delivered WAV: speech span, silent gaps, and speech-active share."""
    y, sr = sf.read(path, dtype="float32")
    sil = silences(y, sr, min_len=0.2)
    hop = int(0.01 * sr)
    env = np.array([np.sqrt((y[i:i + hop] ** 2).mean()) for i in range(0, len(y) - hop, hop)])
    voiced = np.where(env > env.max() * 0.02)[0]
    return {
        "speech_starts_s": round(float(voiced[0] * 0.01), 2), "speech_ends_s": round(float(voiced[-1] * 0.01), 2),
        "silent_gaps_over_0.2s": [{"at_s": round(a, 2), "length_s": round(b - a, 2)} for a, b in sil if 0.4 < a < len(y) / sr - 1.0],
        "speech_active_pct": round(100 * float((env > env.max() * 0.02).mean()), 1), "peak": round(float(np.abs(y).max()), 3),
    }


def main() -> None:
    from kokoro import KPipeline

    OUT.mkdir(parents=True, exist_ok=True)
    work = ROOT / "build" / "pip-voice"
    work.mkdir(parents=True, exist_ok=True)
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    ps, _ = pipe.g2p(SCRIPT)
    manifest = {"script": SCRIPT, "engine": "Kokoro-82M (hexgrad), local, CPU", "language": "American English (lang_code a)", "phonemes": ps, "auditions": {}}
    n_words = sum(n for _, n in CHUNKS)
    for key, a in AUDITIONS.items():
        print(f"{key}: {a['title']}  voice={a['voice']} speed={a['speed']}")
        y, words = synthesize(pipe, a["voice"], a["speed"])
        raw_f0 = f0_stats(y, SAMPLE_RATE)
        mixed, applied = assemble(y, words, a["pauses"])
        stem = f"pip_voice_{key}_{a['name']}"
        raw = work / f"{stem}.raw.wav"
        sf.write(raw, mixed, SAMPLE_RATE)
        wav = OUT / f"{stem}.wav"
        dur = finish_audio(raw, wav)
        run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "192k", str(OUT / f"{stem}.mp3")])
        ver = verify(wav)
        span = ver["speech_ends_s"] - ver["speech_starts_s"]
        talk = span - sum(p["inserted_s"] for p in applied)
        m = {
            "title": a["title"], "voice_preset": a["voice"], "speed": a["speed"],
            "blend": "," in a["voice"],
            "requested_pauses_after_chunks_s": dict(zip([c[0] for c in CHUNKS][:-1], a["pauses"])),
            "inserted_pauses": applied,
            "duration_s": round(dur, 2), "words": n_words,
            "overall_wpm": round(n_words / span * 60), "approx_wpm_excluding_inserted_pauses": round(n_words / talk * 60),
            "pitch": raw_f0, "loudness": lufs(wav), "verification": ver,
            "files": {"wav": f"{stem}.wav", "mp3": f"{stem}.mp3"},
        }
        manifest["auditions"][key] = m
        print(f"   {dur:.1f}s  F0 {raw_f0['median_hz']} Hz  {m['loudness']}")
    (OUT / "settings.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("done")


if __name__ == "__main__":
    main()
