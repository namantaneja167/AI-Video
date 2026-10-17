"""Narration sources: Kokoro (local TTS) or imported audio + timestamps. Both yield the same structure."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000
FINAL_RATE = 48000
TRIM_THRESHOLD = 0.01
LEAD_KEEP_SEC = 0.04
TAIL_KEEP_SEC = 0.10


def run(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:3])} failed:\n{p.stderr[-1500:]}")
    return p.stdout + p.stderr


def audio_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(out.strip().splitlines()[0])


def finish_audio(src: Path, dst: Path, pad_to: float | None = None) -> float:
    """Loudness-normalise to a consistent level, resample, optionally pad with silence. Returns duration."""
    filt = "loudnorm=I=-16:TP=-1.5:LRA=11"
    if pad_to:
        filt += f",apad=whole_dur={pad_to:.3f}"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", filt, "-ar", str(FINAL_RATE), "-ac", "1", str(dst)])
    return audio_duration(dst)


# ---------------------------------------------------------------- Kokoro

def _group_words(tokens, offset: float) -> list[dict]:
    """Merge Kokoro sub-tokens ("is" + "n't", "order" + ",") into whitespace-delimited words."""
    words, cur = [], None
    for t in tokens:
        if t.start_ts is None or t.end_ts is None:
            continue
        if cur is None:
            cur = {"text": t.text, "start": offset + t.start_ts, "end": offset + t.end_ts}
        else:
            cur["text"] += t.text
            cur["end"] = offset + t.end_ts
        if t.whitespace:
            words.append(cur)
            cur = None
    if cur:
        words.append(cur)
    return [w for w in words if any(c.isalnum() for c in w["text"])]


def _trim(audio: np.ndarray) -> tuple[np.ndarray, float]:
    """Trim leading/trailing silence; returns (audio, seconds removed from the start)."""
    loud = np.flatnonzero(np.abs(audio) > TRIM_THRESHOLD)
    if loud.size == 0:
        return audio, 0.0
    a = max(0, loud[0] - int(LEAD_KEEP_SEC * SAMPLE_RATE))
    b = min(len(audio), loud[-1] + int(TAIL_KEEP_SEC * SAMPLE_RATE))
    return audio[a:b], a / SAMPLE_RATE


def synthesize_kokoro(episode: dict, work: Path, final_audio: Path) -> tuple[dict[str, dict], float]:
    """Returns ({segment_id: {start, end, words}}, total_duration) and writes `final_audio`."""
    from kokoro import KPipeline  # imported lazily: heavy

    v = episode["voice"]
    cache = work / "tts-cache"
    cache.mkdir(parents=True, exist_ok=True)
    pipe = None
    pacing = episode["pacing"]
    pieces: list[np.ndarray] = []
    timings: dict[str, dict] = {}
    cursor = pacing["leadInSec"]
    pieces.append(np.zeros(int(cursor * SAMPLE_RATE), dtype=np.float32))

    for seg in episode["narration"]["segments"]:
        spoken = seg.get("speech") or seg["text"]
        key = hashlib.sha1(json.dumps([spoken, v["voice"], v["speed"], v["lang"], "kokoro-0.9"]).encode()).hexdigest()[:16]
        wav, meta = cache / f"{seg['id']}-{key}.wav", cache / f"{seg['id']}-{key}.json"
        if not (wav.exists() and meta.exists()):
            if pipe is None:
                pipe = KPipeline(lang_code=v["lang"], repo_id="hexgrad/Kokoro-82M")
            chunks, words, offset = [], [], 0.0
            for r in pipe(spoken, voice=v["voice"], speed=v["speed"], split_pattern=r"\n+"):
                audio = r.audio.detach().cpu().numpy().astype(np.float32)
                words += _group_words(r.tokens or [], offset)
                chunks.append(audio)
                offset += len(audio) / SAMPLE_RATE
            audio, cut = _trim(np.concatenate(chunks))
            for w in words:
                w["start"] = round(max(0.0, w["start"] - cut), 3)
                w["end"] = round(max(0.0, w["end"] - cut), 3)
            sf.write(wav, audio, SAMPLE_RATE)
            meta.write_text(json.dumps(words))
            print(f"  synthesized {seg['id']} ({len(audio) / SAMPLE_RATE:.2f}s)")
        else:
            print(f"  cached      {seg['id']}")
        audio, _ = sf.read(wav, dtype="float32")
        words = json.loads(meta.read_text())
        dur = len(audio) / SAMPLE_RATE
        timings[seg["id"]] = {
            "start": cursor,
            "end": cursor + dur,
            "words": [{"text": w["text"], "start": cursor + w["start"], "end": cursor + w["end"]} for w in words],
        }
        gap = pacing["segmentGapSec"] + seg.get("pauseAfter", 0.0)
        pieces += [audio, np.zeros(int(gap * SAMPLE_RATE), dtype=np.float32)]
        cursor += dur + gap

    total = cursor - pacing["segmentGapSec"] + pacing["tailSec"]
    pieces.append(np.zeros(int((pacing["tailSec"] - pacing["segmentGapSec"]) * SAMPLE_RATE), dtype=np.float32))
    raw = work / "narration-raw.wav"
    sf.write(raw, np.concatenate(pieces), SAMPLE_RATE)
    duration = finish_audio(raw, final_audio)
    return timings, duration


# ---------------------------------------------------------------- imported narration

def import_narration(episode: dict, audio: Path, timestamps: Path, final_audio: Path) -> tuple[dict[str, dict], float]:
    """Timestamps JSON: {"segments": [{"id", "start", "end", "words": [{"start", "end", "text"?}]?}]}"""
    data = json.loads(timestamps.read_text())
    by_id = {s["id"]: s for s in data["segments"]}
    timings: dict[str, dict] = {}
    prev_end = 0.0
    for seg in episode["narration"]["segments"]:
        t = by_id.get(seg["id"])
        if t is None:
            raise SystemExit(f"timestamps file has no entry for segment '{seg['id']}'")
        if not (0 <= t["start"] < t["end"]) or t["start"] < prev_end - 0.01:
            raise SystemExit(f"segment '{seg['id']}' has out-of-order or empty timing ({t['start']}–{t['end']})")
        prev_end = t["end"]
        timings[seg["id"]] = {"start": t["start"], "end": t["end"], "words": t.get("words")}
    src_dur = audio_duration(audio)
    if prev_end > src_dur + 0.05:
        raise SystemExit(f"timestamps run to {prev_end:.2f}s but the audio is only {src_dur:.2f}s")
    pad = max(src_dur, prev_end + episode["pacing"]["tailSec"])
    duration = finish_audio(audio, final_audio, pad_to=pad)
    return timings, duration


def have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
