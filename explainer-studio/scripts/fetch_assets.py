#!/usr/bin/env python3
"""Download the curated third-party art into public/assets so rendering never touches the network.

Re-run to refresh. Pinned versions and licences are recorded in public/assets/manifest.json.
Needs ffmpeg (alpha keying) and network access once.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets"

LUCIDE_VERSION = "1.59.0"
SIMPLE_ICONS_VERSION = "16.35.0"
THREEDICONS = "https://bvconuycpdvgzbvbkijl.supabase.co/storage/v1/object/public/sizes"

# 3dicons v1 (CC0), "clay" material, "dynamic" camera angle, 500 px: id-slug -> local name
ICONS_3D = {
    "879a83-rupee": "rupee",
    "f71a3e-bag": "bag",
    "8ef1fa-clock": "clock",
    "778c78-key": "key",
    "d3d0c8-copy": "copy",
    "1b714e-tick": "tick",
}
LUCIDE = [
    "receipt-indian-rupee", "history", "table-2", "git-merge", "key-round",
    "copy", "arrow-down", "equal", "split", "layers", "circle-check",
]
SIMPLE_ICONS = ["postgresql"]  # reserved for SQL scenes; not used in the join frame

LICENSE_FILES = {
    "lucide-LICENSE.txt": "https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE",
    "3dicons-LICENSE.txt": "https://raw.githubusercontent.com/realvjy/3dicons/develop/LICENSE",
    "simple-icons-LICENSE.md": "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/LICENSE.md",
    "simple-icons-DISCLAIMER.md": "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/DISCLAIMER.md",
}

manifest: list[dict] = []


def get(url: str) -> bytes:
    # curl is more reliable than urllib against these CDNs (urllib stalled on raw.githubusercontent.com).
    return subprocess.run(["curl", "-sSfL", "--retry", "2", "-m", "60", url], check=True, capture_output=True).stdout


def save(path: Path, data: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def record(**kw) -> None:
    manifest.append(kw)
    print(f"  {kw['file']}")


def main() -> None:
    print("3dicons (CC0, clay, dynamic, 500px)")
    for slug, name in ICONS_3D.items():
        url = f"{THREEDICONS}/{slug}/dynamic/500/clay.webp"
        src = OUT / "3dicons" / "src" / f"{name}-clay-dynamic-500.webp"
        sha = save(src, get(url))
        png = OUT / "3dicons" / f"{name}.png"
        # The source renders sit on pure white; key it out to get a transparent PNG.
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", "colorkey=0xFFFFFF:0.04:0.06,format=rgba", str(png)],
            check=True,
        )
        record(file=str(png.relative_to(OUT)), original=str(src.relative_to(OUT)), source=url, sha256_original=sha,
               license="CC0-1.0", author="Vijay Verma (realvjy) / 3dicons.co",
               attribution="Not required (CC0); credited as a courtesy", note="alpha derived by colour-keying the white background")

    print(f"Lucide {LUCIDE_VERSION} (ISC; some icons also MIT/Feather)")
    for name in LUCIDE:
        url = f"https://cdn.jsdelivr.net/npm/lucide-static@{LUCIDE_VERSION}/icons/{name}.svg"
        path = OUT / "lucide" / f"{name}.svg"
        sha = save(path, get(url))
        record(file=str(path.relative_to(OUT)), source=url, sha256=sha, license="ISC (Feather-derived icons: MIT)",
               author="Lucide Icons and Contributors", attribution="Keep the copyright and permission notice (licenses/lucide-LICENSE.txt)")

    print(f"Simple Icons {SIMPLE_ICONS_VERSION} (CC0 repo; brand marks stay trademarks of their owners)")
    for name in SIMPLE_ICONS:
        url = f"https://cdn.jsdelivr.net/npm/simple-icons@{SIMPLE_ICONS_VERSION}/icons/{name}.svg"
        path = OUT / "simple-icons" / f"{name}.svg"
        sha = save(path, get(url))
        record(file=str(path.relative_to(OUT)), source=url, sha256=sha, license="CC0-1.0 (package); logo trademark belongs to its owner",
               author="Simple Icons contributors", attribution="None required; follow the brand's guidelines (licenses/simple-icons-DISCLAIMER.md)")

    print("licence texts")
    for fname, url in LICENSE_FILES.items():
        save(OUT / "licenses" / fname, get(url))

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"{len(manifest)} assets recorded in public/assets/manifest.json")


if __name__ == "__main__":
    main()
