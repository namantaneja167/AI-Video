#!/usr/bin/env python3
"""Thin wrapper around pipeline/timeline.py for the job runner: JSON in on stdin, timeline JSON out on stdout.

The timeline logic itself (captions, cue rules, scene and chapter placement) is NOT reimplemented: this calls
build_timeline unchanged. Input: {episode, segTimings, source, variant, audioDuration, timingSources?}.
`preview` (a preview name) narrows the episode with `filter_for_preview` first. `timingSources` ({segment id: aligned | estimated | manual}) is attached to the output as a label only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import timeline as tl  # noqa: E402


def main() -> None:
    req = json.load(sys.stdin)
    episode = tl.filter_for_preview(req["episode"], req["preview"]) if req.get("preview") else req["episode"]
    out = tl.build_timeline(episode, req["segTimings"], source=req["source"], variant=req["variant"], audio_duration=req["audioDuration"])
    if req.get("timingSources"):
        out["timingSources"] = req["timingSources"]
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
