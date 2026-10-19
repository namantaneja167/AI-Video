#!/bin/sh
# One-time setup of this checkout.   ./setup.sh               Node packages (exactly the locked versions) and the Python environment for timing logic
#                                    ./setup.sh --narration   the same, plus the Python environment for narration (Apple silicon Mac only)
# Needs Homebrew packages: ffmpeg, python@3.12  (brew install ffmpeg python@3.12; espeak-ng only for the legacy Kokoro tools)
# Nothing here downloads a voice model: narration models are fetched only when you ask for them (see ./studio-app doctor).
set -e
cd "$(dirname "$0")"
for tool in ffmpeg ffprobe node npm; do
  command -v "$tool" >/dev/null || { echo "missing: $tool"; exit 1; }
done
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || true)
[ -n "$PY" ] || { echo "Needs Python 3.10-3.12: brew install python@3.12"; exit 1; }
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
npm ci
# src/generated/manifest.json is git-ignored but imported by src/Root.tsx
mkdir -p src/generated
[ -f src/generated/manifest.json ] || echo '{"compositions": []}' > src/generated/manifest.json
if [ "$1" = "--narration" ]; then
  PY312=$(command -v python3.12 || true)
  [ -n "$PY312" ] || { echo "Narration needs Python 3.12: brew install python@3.12"; exit 1; }
  [ -d .venv-qwen ] || "$PY312" -m venv .venv-qwen
  .venv-qwen/bin/pip install --quiet --upgrade pip
  .venv-qwen/bin/pip install --quiet -r requirements-qwen.txt
  echo "Narration environment ready. The voice models are not downloaded; ./studio-app doctor says which are missing."
fi
echo "Setup complete. Check this computer with: ./studio-app doctor    Then start with: ./studio-app new <folder>"
