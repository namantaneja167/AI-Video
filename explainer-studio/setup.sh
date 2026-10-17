#!/bin/sh
# One-time setup: Python 3.12 venv with Kokoro, and Node dependencies.
# Needs Homebrew packages: ffmpeg, python@3.12, espeak-ng  (brew install ffmpeg python@3.12 espeak-ng)
set -e
cd "$(dirname "$0")"
for tool in ffmpeg ffprobe node npm; do
  command -v "$tool" >/dev/null || { echo "missing: $tool"; exit 1; }
done
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || true)
[ -n "$PY" ] || { echo "Kokoro needs Python 3.10-3.12: brew install python@3.12"; exit 1; }
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
npm install
# src/generated/manifest.json is git-ignored but imported by src/Root.tsx
mkdir -p src/generated
[ -f src/generated/manifest.json ] || echo '{"compositions": []}' > src/generated/manifest.json
echo "Setup complete. Try: ./studio check episodes/join-fanout"
