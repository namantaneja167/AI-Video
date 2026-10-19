#!/usr/bin/env python3
"""Fake audio worker for runner tests: same JSON-lines protocol as workers/audio_worker.py, no models.

Behaviour switches (environment): FAKE_IGNORE_UNLOAD=1 keeps memory after "unload" and still acknowledges;
FAKE_NO_UNLOAD_REPLY=1 never answers unload; FAKE_IGNORE_TERM=1 ignores SIGTERM; FAKE_RESOURCE_TRACKER=1 starts the
helper child the real worker has; FAKE_SLOW_EXIT=<seconds> lingers after acknowledging "shutdown"; FAKE_GENERATE_DELAY=<seconds> delays every generation;
FAKE_STATE_FILE=<path> publishes {pid, held_bytes}; FAKE_LIE_UNLOAD=1 acknowledges unload with nothing held but keeps the memory.
Per-call params: load.hold_mb, generate.{seconds,steps,step_delay,children,crash,hang}.
"""
import json, math, mmap, os, signal, struct, subprocess, sys, time, wave

held = None
loaded = None
children = []
if os.environ.get("FAKE_IGNORE_TERM") == "1":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
if os.environ.get("FAKE_RESOURCE_TRACKER") == "1":  # the real worker has this helper child (multiprocessing); it ignores SIGTERM
    import multiprocessing.resource_tracker as _rt
    _rt.ensure_running()


def publish():
    """FAKE_STATE_FILE: what this process really holds, for tests that model its resident size from it (the OS's own figure moves with swapping)."""
    f = os.environ.get("FAKE_STATE_FILE")
    if f:
        with open(f, "w") as fh:
            json.dump({"pid": os.getpid(), "held_bytes": len(held) if held else 0}, fh)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def write_tone(path, seconds, sr=24000, hz=220):
    n = int(seconds * sr)
    fade = 0 if os.environ.get("FAKE_ABRUPT") == "1" else int(0.12 * sr)  # a finished take ends quietly; FAKE_ABRUPT=1 cuts it off
    def amp(i):
        return min(1.0, (n - 1 - i) / fade) if fade and i > n - fade else 1.0
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * amp(i) * math.sin(2 * math.pi * hz * i / sr))) for i in range(n)))


for line in sys.stdin:
    if not line.strip():
        continue
    msg = json.loads(line)
    i, cmd, p = msg["id"], msg["cmd"], msg.get("params", {})
    try:
        if cmd == "load":
            if loaded:
                send({"id": i, "event": "error", "message": f"model {loaded} is already loaded; unload it first"}); continue
            mb = int(p.get("hold_mb", 0))
            if os.environ.get("FAKE_LOAD_DELAY"):  # a model that takes a while to load
                time.sleep(float(os.environ["FAKE_LOAD_DELAY"]))
            held = mmap.mmap(-1, max(1, mb) * 1024 * 1024)  # anonymous mapping: closing it returns the pages immediately
            for k in range(0, len(held), 4096):
                held[k] = 1  # touch every page so it counts as resident
            loaded = p["model"]
            publish()
            send({"id": i, "event": "result", "data": {"model": loaded, "load_s": 0.01, "active_bytes": len(held)}})
        elif cmd == "generate":
            if os.environ.get("FAKE_LOG"):  # what the caller actually sent, for tests that check recorded inputs
                with open(os.environ["FAKE_LOG"], "a") as lf:
                    lf.write(json.dumps({k: p.get(k) for k in ("ref_sha256", "ref_text", "max_tokens", "expect", "seed")}) + "\n")
            if p.get("crash"):
                os._exit(1)
            t_gen = time.time()
            if os.environ.get("FAKE_GENERATE_FAIL"):  # the engine reports an error for this generation
                send({"id": i, "event": "error", "message": os.environ["FAKE_GENERATE_FAIL"]}); continue
            once = os.environ.get("FAKE_FAIL_ONCE")  # fail the first generation only: the marker file records that it happened
            if once and not os.path.exists(once):
                open(once, "w").close()
                send({"id": i, "event": "error", "message": "generation failed (test: fails once)"}); continue
            for _ in range(int(p.get("children", 0))):
                if p.get("new_session"):  # a child in its OWN session and process group, with grandchildren of its own
                    children.append(subprocess.Popen(["sh", "-c", "sleep 300 & sleep 300 & wait"], start_new_session=True))
                else:
                    children.append(subprocess.Popen(["sleep", "300"]))
            if os.environ.get("FAKE_GENERATE_DELAY"):  # a slow generation, so that a test can stop the app while it runs
                time.sleep(float(os.environ["FAKE_GENERATE_DELAY"]))
            if os.environ.get("FAKE_SEC_PER_WORD"):  # generation time proportional to the words, as a real engine's is
                time.sleep(float(os.environ["FAKE_SEC_PER_WORD"]) * len(p.get("text", "x").split()))
            if p.get("hang"):
                time.sleep(3600)
            steps = int(p.get("steps", 3))
            secs = float(p["seconds"]) if "seconds" in p else max(0.5, 0.3 * len(p.get("text", "x").split()))  # real handler passes text, not seconds
            for s in range(steps):
                time.sleep(float(p.get("step_delay", 0.05)))
                send({"id": i, "event": "progress", "step": "generating", "audio_s": round((s + 1) * secs / steps, 3), "elapsed_s": 0.1 * (s + 1)})
            write_tone(p["out_wav"], secs, hz=220 + int(p.get("seed", 0) or 0) % 200)  # a different seed is a different recording
            send({"id": i, "event": "result", "data": {"duration_s": secs, "sample_rate": 24000, "seed": p.get("seed"), "peak_bytes": len(held) if held else 0, "gen_s": round(time.time() - t_gen, 3), "rtf": round((time.time() - t_gen) / max(secs, 0.001), 3)}})
        elif cmd == "check":
            if os.environ.get("FAKE_LOG"):
                with open(os.environ["FAKE_LOG"], "a") as lf:
                    lf.write(json.dumps({"cmd": "check", "expect": p.get("expect")}) + "\n")
            if os.environ.get("FAKE_CHECK_FAIL"):
                send({"id": i, "event": "error", "message": os.environ["FAKE_CHECK_FAIL"]}); continue
            send({"id": i, "event": "result", "data": {}})
        elif cmd in ("align", "estimate"):
            if os.environ.get("FAKE_LOG"):
                with open(os.environ["FAKE_LOG"], "a") as lf:
                    lf.write(json.dumps({"cmd": cmd, "expect": p.get("expect")}) + "\n")
            if cmd == "align" and loaded != "aligner":
                send({"id": i, "event": "error", "message": "the aligner is not loaded"}); continue
            if "segments" in p:  # real-handler form: spread each segment's words over the wav length
                with wave.open(p["wav"]) as w:
                    dur = w.getnframes() / w.getframerate()
                allw = [(s["id"], x) for s in p["segments"] for x in s["text"].split()]
                d = dur / max(1, len(allw)); per = {s["id"]: [] for s in p["segments"]}
                for k, (sid, x) in enumerate(allw):
                    per[sid].append({"text": x, "start": round(k * d, 3), "end": round((k + 1) * d, 3)})
                segs = [{"id": s["id"], "start": per[s["id"]][0]["start"], "end": per[s["id"]][-1]["end"], "words": per[s["id"]]} for s in p["segments"]]
                send({"id": i, "event": "result", "data": {"segments": segs}})
            else:
                words = p["text"].split()
                d = float(p.get("duration", 1.0)) / max(1, len(words))
                send({"id": i, "event": "result", "data": {"words": [{"text": w, "start": round(k * d, 3), "end": round((k + 1) * d, 3)} for k, w in enumerate(words)]}})
        elif cmd == "unload":
            if os.environ.get("FAKE_NO_UNLOAD_REPLY") == "1":
                time.sleep(3600)
            lie = os.environ.get("FAKE_LIE_UNLOAD") == "1"  # reports nothing held, and keeps holding it
            if os.environ.get("FAKE_IGNORE_UNLOAD") != "1" and not lie and held is not None:
                held.close()
                held = None
            loaded = None if os.environ.get("FAKE_IGNORE_UNLOAD") != "1" else loaded
            publish()
            send({"id": i, "event": "result", "data": {"active_bytes": 0 if lie else (len(held) if held else 0), "cache_bytes": 0, "peak_bytes": 0}})
        elif cmd == "status":
            send({"id": i, "event": "result", "data": {"model": loaded, "active_bytes": len(held) if held else 0, "pid": os.getpid()}})
        elif cmd == "shutdown":
            send({"id": i, "event": "result", "data": {}})
            if os.environ.get("FAKE_SLOW_EXIT"):  # acknowledged, but takes a while to actually exit
                time.sleep(float(os.environ["FAKE_SLOW_EXIT"]))
            break
        else:
            send({"id": i, "event": "error", "message": f"unknown command {cmd}"})
    except Exception as e:  # noqa: BLE001
        send({"id": i, "event": "error", "message": str(e)})
