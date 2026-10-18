#!/usr/bin/env python3
"""Regenerate tests/fixtures/join-fanout from real data.

Inputs are the repository's join-fanout episode and the real Kokoro word timings in
build/join-fanout/tts-cache (written by `./studio narrate`). The per-segment cursor logic below mirrors
pipeline/narration.py::synthesize_kokoro so that the timings handed to pipeline/timeline.py are the ones
a real narrate run would produce, without needing the TTS model.

Outputs (all committed, so tests do not need the cache or the TTS model):
  episode.v1.json           frozen copy of episodes/join-fanout/episode.json
  episode.normalized.json   scripts/validate.ts --out (zod defaults applied)
  seg-timings.full.json     {segment id: {start, end, words}} for the whole episode
  seg-timings.preview.json  same for the `join-multiplication` preview
  timeline.full.json        golden: pipeline.timeline.build_timeline(...) on the above
  timeline.preview.json     golden for the preview
  meta.json                 where the data came from

The goldens are CHARACTERIZATION fixtures: they pin what the code does today. They do not prove the output
is right; they make any change in behaviour visible.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from pipeline import timeline as tl  # noqa: E402

EP_ID = "join-fanout"
OUT = ROOT / "tests" / "fixtures" / EP_ID
CACHE = ROOT / "build" / EP_ID / "tts-cache"
PREVIEW = "join-multiplication"


def cursor_timings(episode: dict) -> tuple[dict, float]:
    v, pacing = episode["voice"], episode["pacing"]
    cursor = pacing["leadInSec"]
    timings: dict[str, dict] = {}
    for seg in episode["narration"]["segments"]:
        spoken = seg.get("speech") or seg["text"]
        key = hashlib.sha1(json.dumps([spoken, v["voice"], v["speed"], v["lang"], "kokoro-0.9"]).encode()).hexdigest()[:16]
        wav, meta = CACHE / f"{seg['id']}-{key}.wav", CACHE / f"{seg['id']}-{key}.json"
        if not (wav.exists() and meta.exists()):
            raise SystemExit(f"missing cache for {seg['id']} ({wav.name}); run ./studio narrate episodes/{EP_ID} first")
        audio, sr = sf.read(wav, dtype="float32")
        dur = len(audio) / sr
        words = json.loads(meta.read_text())
        timings[seg["id"]] = {
            "start": cursor,
            "end": cursor + dur,
            "words": [{"text": w["text"], "start": cursor + w["start"], "end": cursor + w["end"]} for w in words],
        }
        cursor += dur + pacing["segmentGapSec"] + seg.get("pauseAfter", 0.0)
    total = cursor - pacing["segmentGapSec"] + pacing["tailSec"]
    return timings, round(total, 3)


def dump(name: str, obj: object) -> None:
    (OUT / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = ROOT / "episodes" / EP_ID / "episode.json"
    shutil.copyfile(src, OUT / "episode.v1.json")
    subprocess.run(["node", "scripts/validate.ts", str(OUT / "episode.v1.json"), "--out", str(OUT / "episode.normalized.json")], cwd=ROOT, check=True)
    episode = json.loads((OUT / "episode.normalized.json").read_text())

    full_t, full_dur = cursor_timings(episode)
    full_tl = tl.build_timeline(episode, full_t, source="kokoro", variant="full", audio_duration=full_dur)
    dump("seg-timings.full.json", {"audioDuration": full_dur, "segments": full_t})
    dump("timeline.full.json", full_tl)

    prev_ep = tl.filter_for_preview(episode, PREVIEW)
    prev_t, prev_dur = cursor_timings(prev_ep)
    prev_tl = tl.build_timeline(prev_ep, prev_t, source="kokoro", variant=f"preview-{PREVIEW}", audio_duration=prev_dur)
    dump("seg-timings.preview.json", {"audioDuration": prev_dur, "segments": prev_t})
    dump("timeline.preview.json", prev_tl)

    dump("meta.json", {
        "source": "episodes/join-fanout/episode.json + build/join-fanout/tts-cache (real Kokoro af_heart word timings)",
        "segments": len(episode["narration"]["segments"]),
        "previewName": PREVIEW,
        "note": "golden timelines are characterization output of pipeline/timeline.py at fixture creation time",
        "episodeSha256": hashlib.sha256((OUT / "episode.v1.json").read_bytes()).hexdigest(),
    })
    print(f"wrote {OUT.relative_to(ROOT)}: full {full_dur}s, preview {prev_dur}s")

    for label, mine, existing in (("full", full_tl, ROOT / "public/generated/join-fanout/full/timeline.json"),
                                  ("preview", prev_tl, ROOT / "public/generated/join-fanout/preview-join-multiplication/timeline.json")):
        if existing.exists():
            other = json.loads(existing.read_text())
            print(f"  vs existing generated {label}: identical={other == mine}")


if __name__ == "__main__":
    main()
