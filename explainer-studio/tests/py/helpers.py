"""Shared paths and fixture loaders for the Python tests (run with .venv/bin/python -m unittest)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
sys.path.insert(0, str(ROOT))


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text())
