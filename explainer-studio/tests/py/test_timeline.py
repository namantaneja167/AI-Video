"""pipeline/timeline.py: golden fixtures from real Kokoro timings, plus focused unit tests.

The goldens pin current behaviour (characterization), so a change to the timeline logic shows up as a diff.
"""
from __future__ import annotations

import unittest

from helpers import fixture
from pipeline import timeline as tl


class GoldenTimelines(unittest.TestCase):
    def build(self, name: str, variant: str, episode: dict):
        t = fixture(f"join-fanout/seg-timings.{name}.json")
        return tl.build_timeline(episode, t["segments"], source="kokoro", variant=variant, audio_duration=t["audioDuration"])

    def test_full_episode_matches_golden(self):
        episode = fixture("join-fanout/episode.normalized.json")
        self.assertEqual(self.build("full", "full", episode), fixture("join-fanout/timeline.full.json"))

    def test_preview_matches_golden(self):
        episode = tl.filter_for_preview(fixture("join-fanout/episode.normalized.json"), "join-multiplication")
        self.assertEqual(
            self.build("preview", "preview-join-multiplication", episode),
            fixture("join-fanout/timeline.preview.json"),
        )

    def test_invariants_hold_on_real_data(self):
        episode = fixture("join-fanout/episode.normalized.json")
        t = fixture("join-fanout/timeline.full.json")
        segs = {s["id"]: s for s in t["segments"]}
        # every displayed word of every segment got a time span, in order
        for seg in episode["narration"]["segments"]:
            words = segs[seg["id"]]["words"]
            self.assertEqual([w["text"] for w in words], seg["text"].split(), seg["id"])
            self.assertTrue(all(a["start"] <= a["end"] for a in words), seg["id"])
            self.assertTrue(all(a["start"] <= b["start"] + 1e-6 for a, b in zip(words, words[1:])), seg["id"])
        # captions together spell each segment's text, and none overlap in time
        for seg in episode["narration"]["segments"]:
            spelled = " ".join(c["text"] for c in t["captions"] if c["segment"] == seg["id"])
            self.assertEqual(spelled, seg["text"], seg["id"])
        self.assertTrue(all(a["end"] <= b["start"] + 1e-6 for a, b in zip(t["captions"], t["captions"][1:])))
        # scenes are contiguous and cover the whole audio
        self.assertEqual(t["scenes"][0]["start"], 0)
        self.assertEqual(t["scenes"][-1]["end"], t["durationSec"])
        self.assertTrue(all(a["end"] == b["start"] for a, b in zip(t["scenes"], t["scenes"][1:])))
        self.assertEqual([e["time"] for e in t["events"]], sorted(e["time"] for e in t["events"]))


class CaptionPhrases(unittest.TestCase):
    def test_breaks_at_punctuation(self):
        # a clause of up to 5 words stays whole; a longer one is split into balanced parts
        self.assertEqual(tl.auto_caption_phrases("Nothing crashed. The join changed the grain."),
                         ["Nothing crashed.", "The join changed the grain."])
        self.assertEqual(tl.auto_caption_phrases("Nothing crashed. The join changed the grain of the data."),
                         ["Nothing crashed.", "The join changed the", "grain of the data."])  # 8 words -> 4 + 4

    def test_long_clause_is_split_evenly_not_greedily(self):
        self.assertEqual(tl.auto_caption_phrases("one two three four five six"), ["one two three", "four five six"])

    def test_short_text_is_one_phrase(self):
        self.assertEqual(tl.auto_caption_phrases("Take three paid orders"), ["Take three paid orders"])


class WordAlignment(unittest.TestCase):
    def spoken(self, *items):
        return [{"text": t, "start": s, "end": e} for t, s, e in items]

    def test_identical_words_keep_their_own_spans(self):
        out = tl.align_words(["a", "b"], self.spoken(("a", 0, 1), ("b", 1, 2)), 0, 2)
        self.assertEqual([(w["start"], w["end"]) for w in out], [(0, 1), (1, 2)])

    def test_symbol_spoken_as_words_covers_the_spoken_span(self):
        # "₹600" is read "six hundred rupees": the one displayed word spans all three spoken words
        display = ["Pay", "₹600", "now"]
        spoken = self.spoken(("Pay", 0, 1), ("six", 1, 1.4), ("hundred", 1.4, 2), ("rupees", 2, 2.6), ("now", 2.6, 3))
        out = tl.align_words(display, spoken, 0, 3)
        self.assertEqual([w["text"] for w in out], display)
        self.assertEqual((out[1]["start"], out[1]["end"]), (1, 2.6))
        self.assertEqual((out[2]["start"], out[2]["end"]), (2.6, 3))

    def test_displayed_but_never_spoken_word_is_pinned_after_the_previous_word(self):
        out = tl.align_words(["a", "(see", "b"], self.spoken(("a", 0, 1), ("b", 1, 2)), 0, 2)
        self.assertEqual(out[1]["start"], 1)

    def test_no_word_timings_spreads_by_length_across_the_segment(self):
        out = tl.align_words(["aa", "bbbbbb"], None, 0, 10)
        self.assertAlmostEqual(out[0]["end"], 3.0, places=2)  # weights 3 and 7
        self.assertAlmostEqual(out[1]["end"], 10.0, places=2)


class CuesAndPreviews(unittest.TestCase):
    seg = {"start": 10.0, "end": 14.0, "words": [{"start": 10.5, "end": 11}, {"start": 12, "end": 13}]}

    def test_resolve_at_variants(self):
        self.assertAlmostEqual(tl.resolve_at("start", self.seg), 10.5 - tl.CUE_LEAD_SEC)
        self.assertEqual(tl.resolve_at("end", self.seg), 14.0)
        self.assertAlmostEqual(tl.resolve_at({"word": 1}, self.seg), 12 - tl.CUE_LEAD_SEC)
        self.assertEqual(tl.resolve_at({"offset": 1.5}, self.seg), 11.5)

    def test_word_index_beyond_the_end_clamps_to_the_last_word(self):
        self.assertAlmostEqual(tl.resolve_at({"word": 99}, self.seg), 12 - tl.CUE_LEAD_SEC)

    def test_preview_keeps_only_its_segments_scenes_events_and_chapters(self):
        ep = fixture("join-fanout/episode.normalized.json")
        keep = set(ep["previews"]["join-multiplication"]["segments"])
        out = tl.filter_for_preview(ep, "join-multiplication")
        self.assertEqual({s["id"] for s in out["narration"]["segments"]}, keep)
        self.assertTrue(all(e["segment"] in keep for e in out["events"]))
        self.assertTrue(all(set(s["segments"]) <= keep for s in out["scenes"]))
        self.assertLess(len(out["scenes"]), len(ep["scenes"]))
        self.assertEqual(len(ep["narration"]["segments"]), 22)  # the input is not modified


if __name__ == "__main__":
    unittest.main()
