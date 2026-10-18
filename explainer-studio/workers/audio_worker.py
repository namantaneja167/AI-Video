#!/usr/bin/env python3
"""Audio worker: one process, ONE model at a time, JSON-lines protocol (see core/worker.ts). Run with .venv-qwen.

  load      {model: "tts" | "aligner"}        refuses while another model is loaded; offline, pinned revisions only
  generate  {text, ref_wav, ref_sha256, ref_text, seed, out_wav, max_tokens, expect?}   Qwen3-TTS Base, approved reference
  check     {model, expect: {model_revision?, mlx_audio?, mlx?}}                  refuses on a mismatch with the recorded settings
  align     {wav, segments: [{id, text}], language?}                             forced alignment (aligner loaded)
  estimate  {wav, segments: [{id, text}]}                                        envelope + word-length estimate, no model
  unload    {}                                 releases the model and the MLX cache, reports what MLX still holds
  status    {}   shutdown   {}

Progress events carry only what is known. Generation has no known total, so it reports elapsed audio, never a percentage.
Weights are never downloaded here: a missing snapshot is an error, not a silent 1-4 GB fetch.
"""
from __future__ import annotations

import gc
import hashlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

PROTO = sys.stdout
sys.stdout = sys.stderr  # library chatter must not corrupt the protocol stream

TTS_REPO, TTS_REV = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16", "a6eb4f68e4b056f1215157bb696209bc82a6db48"
ALIGN_REPO, ALIGN_REV = "mlx-community/Qwen3-ForcedAligner-0.6B-bf16", "53c8c0e46733eec430e4b53dd6471d0e5dee45f8"

state: dict = {"name": None, "model": None, "t_load": None}


def send(obj: dict) -> None:
    PROTO.write(json.dumps(obj) + "\n")
    PROTO.flush()


def sha256(p: str) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def local_snapshot(repo: str, rev: str) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(repo, revision=rev, local_files_only=True)


def check_expect(p: dict, revision: str) -> None:
    """The caller states which model revision and library version its recorded settings assume; a mismatch refuses the job."""
    from importlib.metadata import version

    e = p.get("expect") or {}
    if e.get("model_revision") not in (None, revision):
        raise RuntimeError(f"recorded model revision {e['model_revision']} does not match the pinned revision {revision} this worker loads")
    if e.get("mlx_audio") not in (None, version("mlx-audio")):
        raise RuntimeError(f"recorded mlx-audio {e['mlx_audio']} does not match installed {version('mlx-audio')}")
    if e.get("mlx") not in (None, version("mlx")):
        raise RuntimeError(f"recorded mlx {e['mlx']} does not match installed {version('mlx')}")


def mem() -> dict:
    import mlx.core as mx

    return {"active_bytes": int(mx.get_active_memory()), "cache_bytes": int(mx.get_cache_memory()), "peak_bytes": int(mx.get_peak_memory())}


def cmd_load(i: int, p: dict) -> None:
    import mlx.core as mx

    if state["model"] is not None:
        raise RuntimeError(f"model {state['name']} is already loaded; unload it first (one model at a time)")
    which = p["model"]
    t0 = time.time()
    mx.reset_peak_memory()
    if which == "tts":
        from mlx_audio.tts.utils import load_model

        model = load_model(local_snapshot(TTS_REPO, TTS_REV))
        mx.eval(model.parameters())
    elif which == "aligner":
        from mlx_audio.stt.utils import load_model

        model = load_model(local_snapshot(ALIGN_REPO, ALIGN_REV))
        mx.eval(model.parameters())
    else:
        raise RuntimeError(f"unknown model {which!r}")
    state.update(name=which, model=model, t_load=time.time())
    send({"id": i, "event": "result", "data": {"model": which, "load_s": round(time.time() - t0, 2), **mem()}})


def cmd_generate(i: int, p: dict) -> None:
    import mlx.core as mx
    import numpy as np
    from scipy.io import wavfile

    if state["name"] != "tts":
        raise RuntimeError("the TTS model is not loaded")
    check_expect(p, TTS_REV)
    if sha256(p["ref_wav"]) != p["ref_sha256"]:
        raise RuntimeError("the reference audio does not match its recorded checksum; refusing to generate")
    mx.random.seed(int(p["seed"]))
    mx.reset_peak_memory()
    t0 = time.time()
    chunks, sr, n, got = [], None, 0, 0.0
    for r in state["model"].generate(text=p["text"], ref_audio=p["ref_wav"], ref_text=p["ref_text"], lang_code="english", max_tokens=int(p["max_tokens"])):
        a = np.array(r.audio, dtype=np.float32)
        chunks.append(a)
        sr = r.sample_rate
        n += 1
        got += len(a) / sr
        send({"id": i, "event": "progress", "step": "generating", "chunks": n, "audio_s": round(got, 2), "elapsed_s": round(time.time() - t0, 1)})
    if not chunks:
        raise RuntimeError("the model produced no audio")
    audio = np.concatenate(chunks)
    Path(p["out_wav"]).parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(p["out_wav"], sr, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
    dur = len(audio) / sr
    send({"id": i, "event": "result", "data": {"duration_s": round(dur, 3), "sample_rate": sr, "chunks": n, "gen_s": round(time.time() - t0, 2), "rtf": round((time.time() - t0) / dur, 2), "seed": int(p["seed"]), **mem()}})


def segment_tokens(proc, segments: list[dict]) -> list[int]:
    return [len(proc.tokenize_space_lang(s["text"])) for s in segments]


def cmd_align(i: int, p: dict) -> None:
    if state["name"] != "aligner":
        raise RuntimeError("the aligner is not loaded")
    segs = p["segments"]
    text = " ".join(s["text"] for s in segs)
    t0 = time.time()
    res = state["model"].generate(audio=p["wav"], text=text, language=p.get("language", "English"))
    items = list(res.items)
    counts = segment_tokens(state["model"].aligner_processor, segs)
    if sum(counts) != len(items):
        raise RuntimeError(f"the aligner returned {len(items)} words for {sum(counts)} expected; refusing to guess the mapping")
    out, k = [], 0
    for s, c in zip(segs, counts):
        words = [{"text": it.text, "start": round(float(it.start_time), 3), "end": round(float(it.end_time), 3)} for it in items[k : k + c]]
        k += c
        out.append({"id": s["id"], "start": words[0]["start"] if words else None, "end": words[-1]["end"] if words else None, "words": words})
    send({"id": i, "event": "result", "data": {"segments": out, "align_s": round(time.time() - t0, 2), **mem()}})


def speech_runs(y, sr: int, rel_db: float = -40.0, min_gap: float = 0.12, min_run: float = 0.10, hop_s: float = 0.005):
    """Stretches of speech separated by real silence (energy envelope, threshold relative to the loudest frame)."""
    import numpy as np

    hop = max(1, int(hop_s * sr))
    n = (len(y) - hop) // hop
    env = np.sqrt(np.array([(y[i * hop : (i + 1) * hop].astype(np.float64) ** 2).mean() for i in range(max(n, 1))]))
    act = env > env.max() * 10 ** (rel_db / 20)
    out, i = [], 0
    while i < len(act):
        if act[i]:
            j = i
            while j < len(act) and act[j]:
                j += 1
            out.append([i * hop_s, j * hop_s])
            i = j
        else:
            i += 1
    if not out:
        return [[0.0, len(y) / sr]]
    merged = [out[0]]
    for a, b in out[1:]:
        if a - merged[-1][1] < min_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [r for r in merged if r[1] - r[0] >= min_run] or [[0.0, len(y) / sr]]


def weight(w: str) -> float:
    return sum(c.isalnum() for c in w) + 1.0


def spread(words: list[str], a: float, b: float) -> list[dict]:
    total = sum(weight(w) for w in words) or 1.0
    t, out = a, []
    for w in words:
        d = (b - a) * weight(w) / total
        out.append({"text": w, "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return out


def cmd_estimate(i: int, p: dict) -> None:
    """FALLBACK, labelled `estimated` downstream. If the number of silence-separated speech runs equals the number of
    segments, each segment gets its run; otherwise all words share the whole detected speech span. Words share their
    span in proportion to their length. No model is involved."""
    import numpy as np
    from scipy.io import wavfile

    sr, y = wavfile.read(p["wav"])
    y = y.astype(np.float32) / 32768 if y.dtype == np.int16 else y.astype(np.float32)
    y = y if y.ndim == 1 else y.mean(axis=1)
    segs, rr = p["segments"], speech_runs(y, sr)
    out = []
    if len(rr) == len(segs):
        for s, (a, b) in zip(segs, rr):
            w = spread(s["text"].split(), a, b)
            out.append({"id": s["id"], "start": w[0]["start"], "end": w[-1]["end"], "words": w})
        method = "per-segment speech runs"
    else:
        allw = spread([x for s in segs for x in s["text"].split()], rr[0][0], rr[-1][1])
        k = 0
        for s in segs:
            n = len(s["text"].split())
            w = allw[k : k + n]
            k += n
            out.append({"id": s["id"], "start": w[0]["start"], "end": w[-1]["end"], "words": w})
        method = "one span for all segments"
    send({"id": i, "event": "result", "data": {"segments": out, "method": method, "speech_runs": len(rr)}})


def cmd_unload(i: int, p: dict) -> None:
    import mlx.core as mx

    state.update(name=None, model=None)
    gc.collect()
    mx.clear_cache()
    send({"id": i, "event": "result", "data": mem()})


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        msg = json.loads(line)
        i, cmd, p = msg["id"], msg["cmd"], msg.get("params", {})
        try:
            if cmd == "load":
                cmd_load(i, p)
            elif cmd == "generate":
                cmd_generate(i, p)
            elif cmd == "check":  # does this worker match the model revision and versions the caller recorded?
                check_expect(p, ALIGN_REV if p.get("model") == "aligner" else TTS_REV)
                send({"id": i, "event": "result", "data": {}})
            elif cmd == "align":
                cmd_align(i, p)
            elif cmd == "estimate":
                cmd_estimate(i, p)
            elif cmd == "unload":
                cmd_unload(i, p)
            elif cmd == "status":
                send({"id": i, "event": "result", "data": {"model": state["name"], "pid": os.getpid(), **(mem() if state["model"] is not None else {})}})
            elif cmd == "shutdown":
                send({"id": i, "event": "result", "data": {}})
                break
            else:
                send({"id": i, "event": "error", "message": f"unknown command {cmd}"})
        except Exception as e:  # noqa: BLE001 - reported to the caller, the worker stays usable
            traceback.print_exc(file=sys.stderr)
            send({"id": i, "event": "error", "message": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
