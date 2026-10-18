"""Reproduce the prototype's accent track with workers/accents.py and compare with its own scene_sfx_only.wav.
stdout JSON: {max_abs_lsb, rms_diff_db, n_events}. The event list is the prototype's list, expressed as data."""
import json, math, sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "workers"))
import accents  # noqa: E402

P = ROOT / "prototypes/pip-scene-10x-v1/audio"
T = json.loads((P / "timing.json").read_text())
c = T["cues"]
db = lambda g: 20 * math.log10(g)  # noqa: E731
ev = [
    ("pop", c["card_in"], db(0.50), {"f": 430, "dur": 0.14}),
    ("pop", c["claim"], db(0.55), {"f": 640, "dur": 0.12}),
    ("swish", c["bars"], db(0.38), {"dur": 0.55}),
    ("ding", c["asterisk_pulse"], db(0.40), {"f": 988, "dur": 0.7}),
    ("tick", c["point"] + 0.30, db(0.55), {}),
    ("whoosh", c["callout"], db(0.42), {"dur": 0.34, "up": True}),
    ("pop", c["callout"] + 0.30, db(0.45), {"f": 520, "dur": 0.12}),
    ("whoosh", c["contrast"], db(0.34), {"dur": 0.30, "up": True, "seed": 9}),
    ("pop", c["lane_long"], db(0.38), {"f": 470, "dur": 0.1}),
    ("thump", c["resolve1"], db(0.60), {"dur": 0.3}),
    ("chime", c["resolve2"], db(0.45), {"freqs": [587.0, 740.0], "dur": 1.0}),
] + [("tick", c["contrast"] + 0.35 + i * 0.22, db(0.30), {"f": 1700 + 120 * (i % 3)}) for i in range(7)]
events = [{"accent": a, "t": t, "gain_db": g, "params": p} for a, t, g, p in ev]

sr, voice = wavfile.read(P / "scene_voice_only.wav")
voice = voice.astype(np.float32) / 32768
mine = accents.accent_track(events, voice, 20 * math.log10(0.25), 0.55)
sr2, ref = wavfile.read(P / "scene_sfx_only.wav")
ref = ref.astype(np.float32) / 32768
q = np.round(np.clip(mine, -1, 1) * 32767) / 32768  # the prototype stored 16-bit audio
d = np.abs(q - ref)
print(json.dumps({"max_abs_lsb": float(d.max() * 32768), "rms_ref": float(np.sqrt((ref ** 2).mean())), "rms_diff": float(np.sqrt((d ** 2).mean())), "n_events": len(events), "len_match": len(q) == len(ref)}))
