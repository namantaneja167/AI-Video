"""Compares frame stills of two renders: PSNR, share of pixels that differ by more than 8/255 in any channel, and the
largest per-channel difference. Measurements only; what they mean for the look is a separate, human judgement.

  .venv-qwen/bin/python scripts/phase3_compare.py <dir> <prefixA> <prefixB> [<prefixA> <prefixB> ...]

Frame names come from <dir>/frames.json. Writes <dir>/compare.json and prints a table.
"""
import json, subprocess, sys
import numpy as np

W, H = 1080, 1920

def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(np.int16)

def main():
    d = sys.argv[1]
    pairs = list(zip(sys.argv[2::2], sys.argv[3::2]))
    frames = json.load(open(f'{d}/frames.json'))
    out = {}
    for a, b in pairs:
        rows = []
        for name, frame in frames:
            x, y = load(f'{d}/{a}-{name}.png'), load(f'{d}/{b}-{name}.png')
            diff = np.abs(x - y)
            mse = float((diff.astype(np.float64) ** 2).mean())
            psnr = float('inf') if mse == 0 else 10 * np.log10(255 ** 2 / mse)
            rows.append({'name': name, 'frame': frame, 'psnr': None if psnr == float('inf') else round(psnr, 2),
                         'identical': bool(mse == 0), 'pct_over_8': round(float((diff.max(axis=2) > 8).mean() * 100), 3), 'max_diff': int(diff.max())})
        out[f'{a}_vs_{b}'] = rows
        print(f'\n{a} vs {b}')
        print(f'{"frame":14s}{"n":>5s}{"PSNR":>9s}{"%>8":>9s}{"max":>5s}')
        for r in rows:
            print(f'{r["name"]:14s}{r["frame"]:5d}{"identical" if r["identical"] else r["psnr"]!s:>9}{r["pct_over_8"]:9.3f}{r["max_diff"]:5d}')
        ps = [r['psnr'] for r in rows if r['psnr'] is not None]
        if ps:
            print(f'PSNR min/median/max over non-identical frames: {min(ps)} / {float(np.median(ps)):.2f} / {max(ps)}')
    json.dump(out, open(f'{d}/compare.json', 'w'), indent=1)

main()
