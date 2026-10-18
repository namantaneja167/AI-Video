"""Run workers/mix.py (final) on the prototype's raw narration take with and without the prototype's accents; print what a
test needs: loudness and true peak of each, how the mix is mastered, and that the voice stays sample-aligned.
Reads the prototype (never writes to it); writes to a temp folder."""
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate

ROOT = Path(__file__).resolve().parents[2]
T = json.loads((ROOT / "prototypes/pip-scene-10x-v1/audio/timing.json").read_text())
ev = json.loads((ROOT / "samples/pip-10x-pipeline/settings.json").read_text())["soundEvents"]
accents = [{"accent": e["accent"], "t": T["cues"][e["cue"]] + e.get("dt", 0), "gain_db": e["gainDb"], "params": e.get("params", {})} for e in ev]
take = str(ROOT / "prototypes/pip-scene-10x-v1/audio/takes/narration_seed11.wav")

def run(td, name, acc):
    out = f"{td}/{name}.wav"
    req = {"out": out, "total_sec": T["durationSec"], "blocks": [{"wav": take, "offset_sec": T["leadSec"]}], "master": {"lufs": -16, "true_peak_db": -1.5, "lra": 11}, "accents": acc, "accent_bus_db": -12.04, "accent_duck": 0.55}
    r = subprocess.run([str(ROOT / ".venv-qwen/bin/python"), str(ROOT / "workers/mix.py")], input=json.dumps(req), capture_output=True, text=True, check=True)
    return out, json.loads(r.stdout)

with tempfile.TemporaryDirectory() as td:
    plain, fp = run(td, "plain", [])
    full, ff = run(td, "full", accents)
    a = wavfile.read(plain)[1].astype(np.float32) / 32768
    b = wavfile.read(full)[1].astype(np.float32) / 32768
    seg = slice(48000 * 2, 48000 * 6)
    lag = int(np.argmax(correlate(b[seg], a[seg], mode="full", method="fft")) - (len(a[seg]) - 1))
    first = int(accents[0]["t"] * 48000)
    # before the first accent the two mixes differ only by the different mastering gain: compare shapes
    # The accent in the finished mix should sit at the level it was authored at (relative to the mastered voice): compare the
    # difference of the two mixes around the first accents with the synthesised accent track itself.
    sys.path.insert(0, str(ROOT / "workers"))
    import accents as acc_mod, mix as mix_mod
    raw = np.zeros(len(a), np.float32)
    v = mix_mod.read_mono(take); o = int(round(T["leadSec"] * 48000)); raw[o:o + len(v)] = v
    ref = acc_mod.accent_track(accents, raw, -12.04, 0.55)
    w0, w1 = int(accents[1]["t"] * 48000), int((accents[1]["t"] + 0.25) * 48000)  # the "claim" pop
    got = float(np.abs((b - a)[w0:w1]).max()); want = float(np.abs(ref[w0:w1]).max())
    accent_db = round(20 * np.log10(got / want), 2)
    print(json.dumps({"accent_level_vs_authored_db": accent_db, "plain": fp["measured"], "full": ff["measured"], "plain_mastering": fp["mastering"], "full_mastering": ff["mastering"], "lag_samples": lag, "length_equal": len(a) == len(b)}))
