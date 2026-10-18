"""Runs workers/mouth.py on the prototype's raw narration take, placed at its lead-in, and compares with the prototype's own mouth track."""
import json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
P = ROOT / "prototypes/pip-scene-10x-v1/audio"
T = json.loads((P / "timing.json").read_text())
req = {"blocks": [{"wav": str(P / "takes/narration_seed11.wav"), "offset_sec": T["leadSec"]}], "total_sec": T["durationSec"], "fps": T["fps"]}
out = subprocess.run([sys.executable, str(ROOT / "workers/mouth.py")], input=json.dumps(req), capture_output=True, text=True, check=True).stdout
mine = json.loads(out)["mouth"]
ref = T["mouth"]
print(json.dumps({"n": len(mine), "len_match": len(mine) == len(ref), "max_abs": max(abs(a - b) for a, b in zip(mine, ref))}))
