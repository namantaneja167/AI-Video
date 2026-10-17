"""Turn an episode plus measured narration timings into a timeline.json for Remotion.

Pure logic with no TTS or media dependencies, so it works for Kokoro and imported narration alike.
"""
from __future__ import annotations

import math
import re
from difflib import SequenceMatcher
from typing import Any

CUE_LEAD_SEC = 0.08  # fire visual cues slightly before the spoken word
SCENE_LEAD_SEC = 0.25  # a scene begins this long before its first spoken word
MAX_CAPTION_WORDS = 5
_PUNCT_BREAK = re.compile(r"[,.:;?!…]$")


def display_words(text: str) -> list[str]:
    return text.split()


def auto_caption_phrases(text: str, max_words: int = MAX_CAPTION_WORDS) -> list[str]:
    """Split at punctuation, then evenly split clauses that are still longer than max_words."""
    clauses: list[list[str]] = []
    cur: list[str] = []
    for w in display_words(text):
        cur.append(w)
        if _PUNCT_BREAK.search(w):
            clauses.append(cur)
            cur = []
    if cur:
        clauses.append(cur)
    phrases: list[str] = []
    for clause in clauses:
        parts = math.ceil(len(clause) / max_words)
        size = math.ceil(len(clause) / parts)
        for i in range(0, len(clause), size):
            phrases.append(" ".join(clause[i : i + size]))
    return phrases


def _weight(word: str) -> float:
    return len(re.sub(r"\W", "", word)) + 1.0


def _norm(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


def _spread(words: list[str], start: float, end: float) -> list[dict]:
    total = sum(_weight(w) for w in words)
    out, t = [], start
    for w in words:
        dur = (end - start) * _weight(w) / total
        out.append({"text": w, "start": round(t, 3), "end": round(t + dur, 3)})
        t += dur
    return out


def align_words(display: list[str], spoken: list[dict] | None, start: float, end: float) -> list[dict]:
    """Give each displayed word a time span.

    Words the voice spoke identically are matched exactly. Where `speech` differs from `text`
    (e.g. "₹100" spoken as "one hundred rupees"), the displayed words in that gap share the
    spoken span of the gap in proportion to their length.
    """
    if not spoken:
        return _spread(display, start, end)
    if len(spoken) == len(display):
        return [{"text": d, "start": round(s["start"], 3), "end": round(s["end"], 3)} for d, s in zip(display, spoken)]
    if any("text" not in s for s in spoken):  # imported timings without text can't be matched word by word
        return _spread(display, spoken[0]["start"], spoken[-1]["end"])
    out: list[dict] = []
    ops = SequenceMatcher(None, [_norm(w) for w in display], [_norm(s["text"]) for s in spoken], autojunk=False).get_opcodes()
    for tag, i1, i2, j1, j2 in ops:
        if i1 == i2:
            continue  # spoken-only words (e.g. "rupees") have nothing to display
        if tag == "equal":
            for d, s in zip(display[i1:i2], spoken[j1:j2]):
                out.append({"text": d, "start": round(s["start"], 3), "end": round(s["end"], 3)})
        elif j1 == j2:  # displayed but never spoken: pin to the previous word's end
            t = out[-1]["end"] if out else spoken[0]["start"]
            out += [{"text": d, "start": round(t, 3), "end": round(t + 0.05, 3)} for d in display[i1:i2]]
        else:
            out += _spread(display[i1:i2], spoken[j1]["start"], spoken[j2 - 1]["end"])
    return out


def resolve_at(at: Any, seg: dict) -> float:
    words = seg["words"]
    if at == "start":
        return words[0]["start"] - CUE_LEAD_SEC
    if at == "end":
        return seg["end"]
    if "word" in at:
        return words[min(at["word"], len(words) - 1)]["start"] - CUE_LEAD_SEC
    return seg["start"] + at["offset"]


def build_timeline(
    episode: dict,
    seg_timings: dict[str, dict],
    *,
    source: str,
    variant: str,
    audio_duration: float,
) -> dict:
    """`episode` is the (already preview-filtered) normalized episode.

    `seg_timings[id]` = {start, end, words: [{start, end}, ...] | None} measured from the narration.
    """
    segments, captions = [], []
    for seg in episode["narration"]["segments"]:
        t = seg_timings[seg["id"]]
        words = align_words(display_words(seg["text"]), t.get("words"), t["start"], t["end"])
        segments.append({"id": seg["id"], "start": round(t["start"], 3), "end": round(t["end"], 3), "words": words})

        phrases = seg.get("captions") or auto_caption_phrases(seg["text"])
        i = 0
        for phrase in phrases:
            n = len(display_words(phrase))
            chunk = words[i : i + n]
            i += n
            captions.append(
                {"segment": seg["id"], "text": phrase, "start": chunk[0]["start"], "end": chunk[-1]["end"], "words": chunk}
            )

    # Each caption stays up until the next begins (or briefly after the segment's last word).
    for k, cap in enumerate(captions):
        hold = cap["end"] + 0.35
        nxt = captions[k + 1] if k + 1 < len(captions) else None
        cap["end"] = round(min(hold, nxt["start"]) if nxt else hold, 3)

    seg_by_id = {s["id"]: s for s in segments}
    events = []
    for e in episode["events"]:
        ev = {"segment": e["segment"], "time": round(max(0.0, resolve_at(e["at"], seg_by_id[e["segment"]])), 3)}
        if e.get("cue"):
            ev["cue"] = e["cue"]
        if e.get("expression"):
            ev["expression"] = e["expression"]
        events.append(ev)
    events.sort(key=lambda ev: ev["time"])

    scenes = []
    for idx, sc in enumerate(episode["scenes"]):
        first = seg_by_id[sc["segments"][0]]
        start = 0.0 if idx == 0 else max(0.0, first["start"] - SCENE_LEAD_SEC)
        scenes.append({"id": sc["id"], "type": sc["type"], "start": round(start, 3), "end": 0.0})
    for idx, sc in enumerate(scenes):
        sc["end"] = scenes[idx + 1]["start"] if idx + 1 < len(scenes) else round(audio_duration, 3)

    chapters = [{"label": c["label"], "start": round(max(0.0, seg_by_id[c["segment"]]["start"] - SCENE_LEAD_SEC), 3)} for c in episode["chapters"]]
    if chapters:
        chapters[0]["start"] = 0.0

    return {
        "version": 1,
        "episodeId": episode["id"],
        "variant": variant,
        "source": source,
        "audio": "audio.wav",
        "durationSec": round(audio_duration, 3),
        "segments": segments,
        "captions": captions,
        "events": events,
        "scenes": scenes,
        "chapters": chapters,
    }


def filter_for_preview(episode: dict, name: str) -> dict:
    """Return a copy of the episode limited to a named preview's segments."""
    keep = list(episode["previews"][name]["segments"])
    keep_set = set(keep)
    out = dict(episode)
    out["narration"] = {"segments": [s for s in episode["narration"]["segments"] if s["id"] in keep_set]}
    scenes = []
    for sc in episode["scenes"]:
        segs = [s for s in sc["segments"] if s in keep_set]
        if segs:
            scenes.append({**sc, "segments": segs})
    out["scenes"] = scenes
    out["events"] = [e for e in episode["events"] if e["segment"] in keep_set]
    out["chapters"] = [c for c in episode["chapters"] if c["segment"] in keep_set]
    return out
