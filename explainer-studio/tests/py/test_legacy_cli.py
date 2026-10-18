"""Legacy `./studio` behaviour must survive the migration: validate, verify checks, `new`, and dependency/doc drift."""
from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import FIXTURES, ROOT, fixture

import studio  # noqa: E402  (the orchestrator; importing it must not run anything)


def run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / "studio.py"), *args], cwd=ROOT, capture_output=True, text=True)


class CheckCommand(unittest.TestCase):
    def test_valid_episodes_pass_including_the_template(self):
        for ep in ("join-fanout", "_template", "my-topic"):
            r = run_cli("check", f"episodes/{ep}")
            self.assertEqual(r.returncode, 0, f"{ep}: {r.stderr}")
            self.assertTrue(r.stdout.startswith("OK "), r.stdout)

    def test_invalid_episode_fails_with_a_readable_reason(self):
        ep = fixture("join-fanout/episode.v1.json")
        ep["scenes"][0]["segments"].pop()
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "episode.json").write_text(json.dumps(ep))
            r = run_cli("check", d)
        self.assertEqual(r.returncode, 1)
        self.assertIn("scenes must list every segment", r.stderr)


class NewCommand(unittest.TestCase):
    def test_new_creates_a_valid_episode_with_the_requested_id(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            shutil.copytree(ROOT / "episodes" / "_template", base / "_template")
            studio.new_episode("my-demo", base)
            made = base / "my-demo" / "episode.json"
            self.assertEqual(json.loads(made.read_text())["id"], "my-demo")
            r = subprocess.run(["node", "scripts/validate.ts", str(made)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            with self.assertRaises(SystemExit):  # refuses to overwrite
                studio.new_episode("my-demo", base)

    def test_new_rejects_a_bad_id(self):
        with self.assertRaises(SystemExit):
            studio.new_episode("Bad Id", Path(tempfile.gettempdir()))

    def test_template_id_placeholder_appears_exactly_once_at_top_level(self):
        text = (ROOT / "episodes" / "_template" / "episode.json").read_text()
        self.assertEqual(text.count(f'"id": "{studio.TEMPLATE_ID}"'), 1)


class VerifyChecks(unittest.TestCase):
    """The checks `./studio verify` applies to timelines and numbers, run on the real fixtures."""

    @staticmethod
    def failed_labels(timeline: dict) -> list[str]:
        failed: list[str] = []

        class Rep(studio.Report):
            def check(self, ok, label, detail=""):
                super().check(ok, label, detail)
                if not ok:
                    failed.append(label)

        studio.verify_timeline(Rep(), timeline)
        return failed

    def test_preview_timeline_passes_every_timeline_check(self):
        self.assertEqual(self.failed_labels(fixture("join-fanout/timeline.preview.json")), [])

    def test_full_timeline_has_exactly_one_known_finding(self):
        # KNOWN FINDING, not a fix: caption "So when a" (s17) is on screen for 0.275 s, under verify's 0.3 s limit.
        # Pinned so that any new failure, or the finding disappearing, is noticed. Resolving it is a content decision.
        self.assertEqual(self.failed_labels(fixture("join-fanout/timeline.full.json")), ["no caption flashes for under 0.3s"])

    def test_overlapping_captions_would_be_caught(self):
        t = fixture("join-fanout/timeline.full.json")
        t["captions"][1]["start"] = t["captions"][0]["start"]
        rep = studio.Report()
        studio.verify_timeline(rep, t)
        self.assertGreater(rep.failed, 0)

    def test_numbers_on_screen_match_sqlite_and_the_spoken_text(self):
        episode = fixture("join-fanout/episode.normalized.json")
        rep = studio.Report()
        studio.verify_numbers(rep, episode, FIXTURES / "join-fanout" / "episode.normalized.json")
        self.assertEqual(rep.failed, 0)

    def test_a_wrong_dashboard_number_would_be_caught(self):
        episode = fixture("join-fanout/episode.normalized.json")
        episode["scenes"][0]["params"]["dashboard"]["value"] = "₹1,700"
        rep = studio.Report()
        studio.verify_numbers(rep, episode, FIXTURES / "join-fanout" / "episode.normalized.json")
        self.assertGreater(rep.failed, 0)


class DependencyDrift(unittest.TestCase):
    """Every third-party module the Python code imports must be declared (this caught num2words)."""

    @staticmethod
    def imported(paths) -> set[str]:
        mods: set[str] = set()
        for p in paths:
            for node in ast.walk(ast.parse(p.read_text())):
                if isinstance(node, ast.Import):
                    mods |= {a.name.split(".")[0] for a in node.names}
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    mods.add(node.module.split(".")[0])
        return mods - set(sys.stdlib_module_names) - {"pipeline", "studio", "helpers", "__future__"}

    @staticmethod
    def declared(req_file: str) -> set[str]:
        names = set()
        for line in (ROOT / req_file).read_text().splitlines():
            line = line.split("#")[0].strip()
            if line:
                names.add(re.split(r"[=<>!~\[ ]", line)[0].lower().replace("-", "_"))
        return names

    def test_main_environment_declares_what_studio_and_pipeline_import(self):
        mods = self.imported([ROOT / "studio.py", *(ROOT / "pipeline").glob("*.py")])
        self.assertTrue(mods >= {"numpy", "soundfile", "kokoro", "num2words"}, mods)
        self.assertEqual(mods - self.declared("requirements.txt"), set())

    def test_qwen_environment_declares_what_the_qwen_scripts_import(self):
        scripts = [ROOT / "scripts" / n for n in ("pip_scene_narration.py", "pip_scene_timing.py", "qwen_consistency_test.py", "qwen_voice_audition.py")]
        mods = self.imported(scripts)
        self.assertEqual(mods - self.declared("requirements-qwen.txt"), set(), "undeclared imports in the Qwen scripts")

    def test_qwen_requirements_are_fully_pinned(self):
        lines = [l.strip() for l in (ROOT / "requirements-qwen.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
        self.assertTrue(lines)
        self.assertTrue(all("==" in l for l in lines), [l for l in lines if "==" not in l])


class ReadmeDrift(unittest.TestCase):
    readme = (ROOT / "README.md").read_text()
    GENERATED = ("public/generated", "out/", "build/", "src/generated", ".venv", "node_modules")

    def test_every_studio_subcommand_in_the_readme_exists(self):
        real = {"check", "narrate", "import", "render", "verify", "new"}
        used = set(re.findall(r"\./studio (\w+)", self.readme))
        self.assertTrue(used <= real, used - real)
        self.assertTrue({"check", "narrate", "render", "verify", "new", "import"} <= used, "README should document every command")

    def test_paths_named_in_the_readme_exist(self):
        paths = set(re.findall(r"`((?:src|scripts|pipeline|episodes|public|docs|prototypes|reference|tests|core)/[\w./<>-]+?)`", self.readme))
        missing = []
        for p in paths:
            if any(p.startswith(g) for g in self.GENERATED) or "<" in p:
                continue
            if not (ROOT / p.rstrip("/")).exists():
                missing.append(p)
        self.assertEqual(missing, [])

    def test_readme_no_longer_points_at_the_removed_presenter(self):
        self.assertNotIn("src/components/Presenter.tsx", self.readme)
        self.assertFalse((ROOT / "src" / "components" / "Presenter.tsx").exists())

    def test_npm_scripts_named_in_the_readme_exist(self):
        scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
        for name in re.findall(r"npm (?:run )?(\w[\w:-]*)", self.readme):
            if name in {"install", "ci"}:
                continue
            self.assertIn(name, scripts, name)


if __name__ == "__main__":
    unittest.main()
