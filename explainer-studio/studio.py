#!/usr/bin/env python3
"""Production orchestrator for explainer episodes.

  ./studio check   episodes/<id>                      validate the episode file
  ./studio narrate episodes/<id> [--preview NAME]     Kokoro narration -> timeline + audio (for Studio / render)
  ./studio import  episodes/<id> --audio A --timestamps T   use existing narration instead of Kokoro
  ./studio render  episodes/<id> [--preview NAME]     narrate (if needed) then render MP4 to out/
  ./studio verify  episodes/<id> [--preview NAME]     numbers, timeline, audio and rendered-video checks
  ./studio new     <id>                               copy the template to episodes/<id>
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from pipeline import narration as nar  # noqa: E402
from pipeline import timeline as tl  # noqa: E402

FPS, WIDTH, HEIGHT = 30, 1080, 1920


# ------------------------------------------------------------------ helpers

def die(msg: str) -> "None":
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(1)


def ep_json_path(arg: str) -> Path:
    p = Path(arg)
    p = p if p.is_absolute() else Path.cwd() / p
    if p.is_dir():
        p = p / "episode.json"
    if not p.exists():
        die(f"{p} not found")
    return p


def load_episode(arg: str) -> tuple[dict, Path]:
    """Validate with the same zod schema Remotion uses; returns the normalized episode."""
    path = ep_json_path(arg)
    norm = ROOT / "build" / ".normalized" / f"{path.parent.name}.json"
    norm.parent.mkdir(parents=True, exist_ok=True)
    p = subprocess.run(["node", "scripts/validate.ts", str(path), "--out", str(norm)], cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(p.stdout)
    if p.returncode != 0:
        sys.stderr.write(p.stderr)
        raise SystemExit(1)
    return json.loads(norm.read_text()), path


def variant_name(preview: str | None) -> str:
    return f"preview-{preview}" if preview else "full"


def gen_dir(ep_id: str, variant: str) -> Path:
    return ROOT / "public" / "generated" / ep_id / variant


def out_file(ep_id: str, variant: str) -> Path:
    return ROOT / "out" / f"{ep_id}-{variant}.mp4"


def update_manifest() -> None:
    comps = []
    base = ROOT / "public" / "generated"
    for tpath in sorted(base.glob("*/*/timeline.json")):
        comps.append({"episode": tpath.parent.parent.name, "variant": tpath.parent.name})
    (ROOT / "src" / "generated").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "generated" / "manifest.json").write_text(json.dumps({"compositions": comps}, indent=2))


# ------------------------------------------------------------------ prepare (narrate / import)

def prepare(arg: str, preview: str | None, imported: tuple[Path, Path] | None) -> tuple[dict, Path]:
    if not nar.have_ffmpeg():
        die("ffmpeg/ffprobe not found (brew install ffmpeg)")
    episode, _ = load_episode(arg)
    if preview:
        if preview not in episode["previews"]:
            die(f"preview '{preview}' not defined; available: {', '.join(episode['previews']) or 'none'}")
        if imported:
            die("imported narration covers the whole episode; preview slicing is not supported with --audio")
        episode = tl.filter_for_preview(episode, preview)
    variant = variant_name(preview)
    out = gen_dir(episode["id"], variant)
    out.mkdir(parents=True, exist_ok=True)
    work = ROOT / "build" / episode["id"]
    work.mkdir(parents=True, exist_ok=True)

    if imported:
        print(f"Importing narration from {imported[0].name}")
        timings, duration = nar.import_narration(episode, imported[0], imported[1], out / "audio.wav")
        source = "imported"
    else:
        print(f"Synthesizing {len(episode['narration']['segments'])} segments with Kokoro ({episode['voice']['voice']})")
        timings, duration = nar.synthesize_kokoro(episode, work, out / "audio.wav")
        source = "kokoro"

    timeline = tl.build_timeline(episode, timings, source=source, variant=variant, audio_duration=duration)
    (out / "timeline.json").write_text(json.dumps(timeline, indent=2, ensure_ascii=False))
    (out / "episode.json").write_text(json.dumps(episode, indent=2, ensure_ascii=False))
    update_manifest()
    print(f"Wrote {out.relative_to(ROOT)}  (duration {duration:.2f}s, {len(timeline['captions'])} caption phrases)")
    return episode, out


# ------------------------------------------------------------------ render

def comp_id(ep_id: str, variant: str) -> str:
    return f"{ep_id}--{variant}"


def render(arg: str, preview: str | None, force_narrate: bool, imported=None) -> Path:
    episode, _ = load_episode(arg)
    variant = variant_name(preview)
    if force_narrate or not (gen_dir(episode["id"], variant) / "timeline.json").exists():
        prepare(arg, preview, imported)
    out = out_file(episode["id"], variant)
    out.parent.mkdir(exist_ok=True)
    cmd = ["npx", "remotion", "render", "src/index.ts", comp_id(episode["id"], variant), str(out),
           "--crf=18", "--audio-codec=aac", "--audio-bitrate=192k"]
    print("Rendering:", " ".join(cmd))
    if subprocess.run(cmd, cwd=ROOT).returncode != 0:
        die("remotion render failed")
    print(f"Rendered {out}")
    return out


# ------------------------------------------------------------------ verify

class Report:
    def __init__(self) -> None:
        self.failed = 0

    def check(self, ok: bool, label: str, detail: str = "") -> None:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
        if not ok:
            self.failed += 1


def sql_numbers(lab: dict) -> dict:
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE orders(order_id INTEGER PRIMARY KEY, amount INTEGER)")
    con.execute("CREATE TABLE order_status_history(id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT, changed_at TEXT)")
    con.executemany("INSERT INTO orders VALUES (?,?)", [(o["id"], o["amount"]) for o in lab["orders"]])
    con.executemany("INSERT INTO order_status_history VALUES (?,?,?,?)",
                    [(h["id"], h["orderId"], h["status"], h["at"]) for h in lab["history"]])
    joined = "FROM orders o JOIN order_status_history h ON h.order_id = o.order_id"
    return {
        "naiveSum": con.execute(lab["wrongSql"]).fetchone()[0],
        "joinedCount": con.execute(f"SELECT COUNT(*) {joined}").fetchone()[0],
        "joinedDistinctOrders": con.execute(f"SELECT COUNT(DISTINCT o.order_id) {joined}").fetchone()[0],
        "fixedSum": con.execute(lab["fixedSql"]).fetchone()[0],
        # Independent ground truth: sum of amounts of orders whose latest status is paid.
        "trueTotal": con.execute(
            "SELECT COALESCE(SUM(o.amount),0) FROM orders o WHERE (SELECT status FROM order_status_history h "
            "WHERE h.order_id = o.order_id ORDER BY changed_at DESC, id DESC LIMIT 1) = 'paid'").fetchone()[0],
    }


def money(n: int, cur: str = "₹") -> str:
    s = f"{abs(n):d}"
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"\B(?=(\d{2})+(?!\d))", ",", head)
        s = f"{head},{tail}"
    return f"{cur}{s}"


def verify_numbers(rep: Report, episode: dict, norm_path: Path) -> None:
    print("Numbers")
    lab = next((s for s in episode["scenes"] if s["type"] == "tables-lab"), None)
    if not lab:
        print("  (no tables-lab scene)")
        return
    p = lab["params"]
    sql = sql_numbers(p)
    model = json.loads(subprocess.run(["node", "scripts/model.ts", str(norm_path)], cwd=ROOT, capture_output=True, text=True).stdout)
    for k, v in sql.items():
        rep.check(model[k] == v, f"on-screen model {k} == SQLite", f"{model[k]} vs {v}")
    rep.check(sql["joinedCount"] == len(p["history"]), "joined rows = history rows", str(sql["joinedCount"]))
    rep.check(sql["joinedDistinctOrders"] == len(p["orders"]), "distinct orders in join = orders", str(sql["joinedDistinctOrders"]))
    rep.check(sql["fixedSum"] == sql["trueTotal"], "repaired SQL total equals ground truth", f"{sql['fixedSum']}")
    rep.check(sql["naiveSum"] != sql["trueTotal"], "naive total differs (the bug exists)", f"{sql['naiveSum']} vs {sql['trueTotal']}")
    cur = p["currency"]
    for sc in episode["scenes"]:
        if sc["type"] == "kpi-mismatch":
            rep.check(sc["params"]["dashboard"]["value"] == money(sql["naiveSum"], cur), "hook dashboard value", sc["params"]["dashboard"]["value"])
            rep.check(sc["params"]["expected"]["value"] == money(sql["trueTotal"], cur), "hook expected value", sc["params"]["expected"]["value"])
    # Narration: each displayed ₹ amount in the lab-driven segments must be spoken correctly.
    from num2words import num2words
    allowed = {o["amount"] for o in p["orders"]} | {sql["naiveSum"], sql["trueTotal"]}
    for seg in episode["narration"]["segments"]:
        for m in re.finditer(r"₹([\d,]+)", seg["text"]):
            n = int(m.group(1).replace(",", ""))
            spoken = (seg.get("speech") or "").lower().replace("-", " ").replace(",", "")
            forms = {num2words(n).replace("-", " ").replace(",", "").replace(" and ", " "), num2words(n, to="year").replace("-", " ").replace(",", "")}
            if n in allowed or n == 400:
                rep.check(any(f in spoken for f in forms), f"{seg['id']}: ₹{n} is spoken correctly", f"expects one of {sorted(forms)}")
            else:
                rep.check(False, f"{seg['id']}: ₹{n} is not derived from the dataset")


def verify_timeline(rep: Report, tline: dict) -> None:
    print("Timeline & captions")
    dur = tline["durationSec"]
    segs = tline["segments"]
    rep.check(all(a["end"] <= b["start"] + 1e-6 for a, b in zip(segs, segs[1:])), "segments are ordered and non-overlapping")
    rep.check(segs[-1]["end"] <= dur and segs[0]["start"] >= 0, "segments lie inside the audio", f"{segs[0]['start']:.2f}–{segs[-1]['end']:.2f} of {dur:.2f}s")
    caps = tline["captions"]
    rep.check(all(a["end"] <= b["start"] + 1e-6 for a, b in zip(caps, caps[1:])), "caption phrases never overlap", f"{len(caps)} phrases")
    sb = {s["id"]: s for s in segs}
    off = max((max(c["start"] - sb[c["segment"]]["start"] for c in caps), 0))
    rep.check(all(sb[c["segment"]]["start"] - 1e-6 <= c["start"] and c["start"] < sb[c["segment"]]["end"] for c in caps), "each caption starts inside its segment")
    rep.check(all(c["end"] - c["start"] >= 0.3 for c in caps), "no caption flashes for under 0.3s", f"min {min(c['end'] - c['start'] for c in caps):.2f}s")
    rep.check(all(len(c["text"].split()) <= 6 for c in caps), "captions are short phrases (<= 6 words)")
    words = [w for s in segs for w in s["words"]]
    rep.check(all(w["start"] <= w["end"] for w in words) and all(a["start"] <= b["start"] + 1e-6 for a, b in zip(words, words[1:])), "word timings are monotonic", f"{len(words)} words")
    rep.check(all(0 <= e["time"] <= dur for e in tline["events"]), "all events inside the timeline", f"{len(tline['events'])} events")
    rep.check(tline["scenes"][0]["start"] == 0 and abs(tline["scenes"][-1]["end"] - dur) < 1e-3, "scenes cover the whole video")


def ffprobe_json(path: Path) -> dict:
    return json.loads(nar.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))


def verify_video(rep: Report, tline: dict, mp4: Path, frames_dir: Path) -> None:
    print(f"Rendered video {mp4.name}")
    if not mp4.exists():
        rep.check(False, "MP4 exists", "run ./studio render first")
        return
    info = ffprobe_json(mp4)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    rep.check((v["width"], v["height"]) == (WIDTH, HEIGHT), "resolution 1080x1920", f"{v['width']}x{v['height']}")
    num, den = map(int, v["r_frame_rate"].split("/"))
    rep.check(num / den == FPS, "30 fps", v["r_frame_rate"])
    rep.check(a is not None, "audio stream present", a["codec_name"] if a else "missing")
    dur = float(info["format"]["duration"])
    rep.check(abs(dur - tline["durationSec"]) < 0.1, "video duration matches narration", f"{dur:.2f}s vs {tline['durationSec']:.2f}s")
    if not a:
        return
    # Audio actually carries the narration: decode the MP4's audio and compare speech onsets with the timeline.
    import numpy as np
    import soundfile as sf
    tmp = ROOT / "build" / ".verify-audio.wav"
    nar.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4), "-vn", "-ac", "1", "-ar", "16000", str(tmp)])
    pcm, sr = sf.read(tmp, dtype="float32")
    win = int(sr * 0.02)
    env = np.sqrt(np.convolve(pcm**2, np.ones(win) / win, mode="same"))
    thr = max(env.max() * 0.05, 1e-4)
    rep.check(env.max() > 0.01, "audio is not silent", f"peak RMS {env.max():.3f}")
    worst, fails = 0.0, []
    segs = tline["segments"]
    for i, s in enumerate(segs):
        # Search only between the midpoints of the neighbouring gaps so adjacent segments can't leak in.
        lo_t = (segs[i - 1]["end"] + s["start"]) / 2 if i > 0 else max(0.0, s["start"] - 0.4)
        hi_t = (s["end"] + segs[i + 1]["start"]) / 2 if i + 1 < len(segs) else s["end"] + 0.4
        lo, hi = int(lo_t * sr), int(min(len(env) / sr, hi_t) * sr)
        idx = np.flatnonzero(env[lo:hi] > thr)
        if idx.size == 0:
            fails.append(f"{s['id']}: silent")
            continue
        onset, offset = (lo + idx[0]) / sr, (lo + idx[-1]) / sr
        d = max(abs(onset - s["start"]), abs(offset - s["end"]))
        worst = max(worst, d)
        if d > 0.25:
            fails.append(f"{s['id']}: off by {d:.2f}s")
    rep.check(not fails, "speech onset/offset in the MP4 matches segment timing", f"worst drift {worst * 1000:.0f} ms" + (f"; {fails}" if fails else ""))
    # Frames for visual inspection: one per segment midpoint.
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("*.png"):
        old.unlink()
    for s in tline["segments"]:
        t = (s["start"] + s["end"]) / 2
        nar.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(mp4), "-frames:v", "1", str(frames_dir / f"{s['id']}.png")])
    print(f"  frames written to {frames_dir.relative_to(ROOT)} (one per segment) for visual inspection")


def verify(arg: str, preview: str | None) -> None:
    episode, path = load_episode(arg)
    norm_path = ROOT / "build" / ".normalized" / f"{path.parent.name}.json"
    variant = variant_name(preview)
    rep = Report()
    verify_numbers(rep, episode, norm_path)
    tpath = gen_dir(episode["id"], variant) / "timeline.json"
    if not tpath.exists():
        die(f"{tpath.relative_to(ROOT)} missing; run ./studio narrate first")
    tline = json.loads(tpath.read_text())
    verify_timeline(rep, tline)
    verify_video(rep, tline, out_file(episode["id"], variant), ROOT / "out" / "verify" / f"{episode['id']}-{variant}")
    print(f"\n{'ALL CHECKS PASSED' if rep.failed == 0 else str(rep.failed) + ' CHECK(S) FAILED'}")
    raise SystemExit(1 if rep.failed else 0)


# ------------------------------------------------------------------ new

TEMPLATE_ID = "episode-id"  # valid under the schema so the template itself passes `check`


def new_episode(ep_id: str, episodes_dir: Path | None = None) -> None:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", ep_id):
        die("episode id must be lowercase letters, digits, - or _")
    base = episodes_dir or ROOT / "episodes"
    dest = base / ep_id
    if dest.exists():
        die(f"{dest} already exists")
    shutil.copytree(base / "_template", dest)
    f = dest / "episode.json"
    f.write_text(f.read_text().replace(f'"id": "{TEMPLATE_ID}"', f'"id": "{ep_id}"', 1))
    print(f"Created {dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest}. Edit episode.json, then: ./studio narrate episodes/{ep_id}")


# ------------------------------------------------------------------ main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "narrate", "render", "verify", "import"):
        p = sub.add_parser(name)
        p.add_argument("episode")
        if name != "check":
            p.add_argument("--preview", help="render only a named preview from the episode's `previews`")
        if name == "render":
            p.add_argument("--renarrate", action="store_true", help="regenerate narration before rendering")
        if name == "import":
            p.add_argument("--audio", required=True)
            p.add_argument("--timestamps", required=True)
    sub.add_parser("new").add_argument("id")
    args = ap.parse_args()

    if args.cmd == "check":
        load_episode(args.episode)
    elif args.cmd == "narrate":
        prepare(args.episode, args.preview, None)
    elif args.cmd == "import":
        prepare(args.episode, args.preview, (Path(args.audio).resolve(), Path(args.timestamps).resolve()))
    elif args.cmd == "render":
        render(args.episode, args.preview, args.renarrate)
    elif args.cmd == "verify":
        verify(args.episode, args.preview)
    elif args.cmd == "new":
        new_episode(args.id)


if __name__ == "__main__":
    main()
