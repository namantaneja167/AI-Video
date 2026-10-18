# Explainer Studio

Local pipeline for faceless technical explainer videos: an episode JSON (script + storyboard you approved elsewhere) goes in, a 1080×1920, 30 fps narrated MP4 comes out. No LLM, paid API or browser automation is involved.

This directory holds two things, kept apart on purpose:

* **The working pipeline** (`./studio`, `pipeline/`, `src/`), described below. It keeps working unchanged while the app is built.
* **The planned local app**: specification, mockups, architecture and phased plan in [`docs/studio/`](docs/studio/README.md). Phases 0 to 2 are in place: tests and fixtures, the v2 format with migration, the project store (`core/`: SQLite, revisions, blobs, snapshots, approvals, backup, cleanup), and the job runner with its audio, mix and render workers (`core/runner.ts`, `core/handlers.ts`, `workers/`; results in [`docs/studio/06-phase2-acceptance.md`](docs/studio/06-phase2-acceptance.md)). There is no UI yet, and the legacy `./studio` commands remain the way to make videos today.

```
episodes/<id>/episode.json ──► ./studio narrate ──► public/generated/<id>/<variant>/{audio.wav,timeline.json,episode.json}
                                                      │
                                       Remotion Studio (preview)  /  ./studio render ──► out/<id>-<variant>.mp4
```

## Install (once)

Requires macOS or Linux, Node 24 or newer (developed on 26.4), and Homebrew packages `ffmpeg`, `python@3.12`, `espeak-ng`.

```sh
brew install ffmpeg python@3.12 espeak-ng
./setup.sh          # creates .venv (Kokoro, numpy, soundfile, num2words) and runs npm install
```

The first narration downloads the Kokoro model (~330 MB) from Hugging Face; after that it works offline. The first render downloads Remotion's headless browser.

Optional, for the Qwen3-TTS scripts (Apple Silicon, Python 3.12):

```sh
python3.12 -m venv .venv-qwen && .venv-qwen/bin/pip install -r requirements-qwen.txt
```

`requirements-qwen.txt` is the exact environment the prototype was built with. Models download into the Hugging Face cache on first use.

## Preview

```sh
./studio narrate episodes/join-fanout                                  # full episode audio + timing
./studio narrate episodes/join-fanout --preview join-multiplication    # 15–20 s preview only
npm run studio                                                         # Remotion Studio
```

In Remotion Studio pick `join-fanout--full` or `join-fanout--preview-join-multiplication` in the sidebar. Re-run `./studio narrate` after editing the script; unchanged segments are cached, so only edited lines are re-synthesized.

## Render and verify

```sh
./studio render episodes/join-fanout --preview join-multiplication     # -> out/join-fanout-preview-join-multiplication.mp4
./studio render episodes/join-fanout                                   # -> out/join-fanout-full.mp4
./studio verify episodes/join-fanout [--preview NAME]
```

`verify` recomputes the numbers with SQLite (running the SQL shown on screen), cross-checks them against the on-screen model, checks caption/word/event timing, and inspects the MP4 (resolution, fps, audio stream, speech onsets vs. the timeline). It also writes one frame per segment to `out/verify/` for visual inspection.

Known limit: `verify` does not notice that a rendered MP4 is older than the code or episode that produced it. Re-render after changes. (Detecting this is part of the planned app.)

## Create another episode

```sh
./studio new my-topic            # copies episodes/_template
```

Edit `episodes/my-topic/episode.json`, then `./studio check episodes/my-topic` (validates with the same schema Remotion uses) and `./studio narrate episodes/my-topic`.

| Field | Purpose |
| --- | --- |
| `narration.segments[]` | `id`, `text` (shown in captions), optional `speech` (what the voice says, e.g. "six hundred rupees" for "₹600"), optional `captions` (hand-written phrases), `pauseAfter` |
| `scenes[]` | `type` + `params`; `segments` lists the narration it covers. Scenes must cover every segment in order. |
| `events[]` | `{segment, at, cue}` or `{segment, at, expression}`. `at` is `"start"`, `"end"`, `{"word": n}` or `{"offset": seconds}`. Timing comes from the generated narration, never from a fixed speaking rate. |
| `chapters[]` | The chips along the top |
| `sources[]`, `reviewNotes[]` | Technical review trail (not rendered) |
| `previews{}` | Named subsets of consecutive segments for short previews |

Scene types and their cues (`src/schema.ts` is the reference):

- `kpi-mismatch`: cues `checks`, `dashboard`, `expected`, `mismatch`
- `tables-lab`: cues `show-orders`, `show-history`, `grain-note`, `join-start`, `sum-start`, `counts`, `inspect-order`, `repair-start`, `pick-latest`, `rejoin`, `fixed-sum`
- `cards`: cues `card-1` … `card-4`

Expressions (`neutral`, `thinking`, `surprised`, `happy`, `concerned`, `pointing`) are accepted and carried into the timeline, but the episode composition currently has no presenter to show them. They have no visible effect until a mascot is wired in.

## Use existing narration instead of Kokoro

```sh
./studio import episodes/my-topic --audio narration.wav --timestamps timestamps.json
```

```json
{"segments": [
  {"id": "s01", "start": 0.4, "end": 5.1, "words": [{"start": 0.4, "end": 0.7}]},
  {"id": "s02", "start": 5.6, "end": 9.0}
]}
```

`words` is optional (word times are then spread across the segment). Every segment id must appear, in order, with times in seconds in the audio file. Imported narration is for the full episode only (no `--preview`).

## Tests

```sh
npm test               # TypeScript (node --test) then Python (unittest); about 25 s, no GPU, no TTS model
npm run test:ts
npm run test:py
npm run test:slow      # also re-renders a frame of the preserved prototype and compares it (a few seconds)
npm run typecheck
```

What they cover: the episode schema and its error messages; golden timelines built from the real join-fanout narration timings (a change in `pipeline/timeline.py` shows up as a diff); the contract between the Python timeline and the TypeScript schema Remotion reads; the `verify` number and timeline checks, including cases that must fail; `./studio check` and `new`; the v1 to v2 migration and its round trip; the prototype's checksum manifest; the project store (saves, revisions, recovery after `kill -9`, dependency tracking, approval, backup and restore, reference-safe cleanup); the rule that legacy commands never substitute a Kokoro voice for a Qwen episode; and drift guards (undeclared Python imports, commands or paths in this README that do not exist).

Fixtures live in `tests/fixtures/`. `tests/fixtures/make_join_fanout_fixture.py` regenerates the join-fanout set from `build/join-fanout/tts-cache` (needs a prior `./studio narrate`). The goldens pin current behaviour; they do not prove it is right.

## Migration to the v2 episode format (draft)

```sh
npm run migrate -- episodes/join-fanout/episode.json --check      # prove v1 -> v2 -> v1 reproduces the episode
npm run migrate -- episodes/join-fanout/episode.json --out /tmp/v2.json
npm run migrate -- /tmp/v2.json --down                            # v2 -> v1; refuses if anything would be lost unless --accept-loss
```

`src/schema2.ts` and `src/migrate.ts` are not used by Remotion. The legacy commands read an episode through `scripts/validate.ts`, which accepts a v2 file only if it converts to v1 with nothing lost; a Qwen episode is refused with an explanation, never narrated with a Kokoro voice.

## Project store (Phase 1)

A SQLite project database (`.studio/project.sqlite`, ignored by git) is the authoritative store for episodes, revisions, takes, snapshots, approvals and artifact metadata; media lives in `.studio/blobs/` by content hash. `episodes/<id>/episode.json` stays in git as a projection of the current revision. Nothing in the existing pipeline uses the store yet, and nothing creates it until you run `init`.

```sh
node scripts/project.ts init                                  # create .studio in this repository
node scripts/project.ts adopt episodes/join-fanout/episode.json   # take an episode under management (the file is left as is)
node scripts/project.ts status                                # episodes, stale outputs, approval, external changes
node scripts/project.ts external                              # episode.json files edited outside the store
node scripts/project.ts import-external <id>                  # accept such an edit as a new revision (or: keep-project <id>)
node scripts/project.ts backup <dir> [--include-drafts]       # self-contained, checksummed backup
node scripts/project.ts restore <backupDir> <emptyDir>        # verified restore into an empty folder
node scripts/project.ts gc [--thin]                           # preview: prints the exact plan (incl. thinned revisions) and a digest
node scripts/project.ts gc --thin --apply --expect <digest>   # runs only if a fresh plan has the same digest
```

Destructive tests run only on temporary projects. Add `--root <dir>` to work on another project. Design and limits: [`docs/studio/04-architecture.md`](docs/studio/04-architecture.md).

## Third-party art

All third-party art is copied into `public/assets/` (nothing is fetched at render time). `public/assets/manifest.json` records each file's source URL, version, SHA-256, licence and attribution requirement; licence texts are in `public/assets/licenses/`. Re-download with `.venv/bin/python scripts/fetch_assets.py`.

| Source | Licence | Use |
| --- | --- | --- |
| [3dicons v1](https://3dicons.co) ("clay" material) | CC0-1.0 | 3D objects. The white render backgrounds are colour-keyed to alpha (original WebPs kept in `3dicons/src`). |
| [Lucide](https://lucide.dev) 1.59.0 | ISC (some Feather-derived icons MIT) | Technical symbols; keep `licenses/lucide-LICENSE.txt` with any redistribution. |
| [Simple Icons](https://simpleicons.org) 16.35.0 | CC0 package; logos are trademarks of their owners | Product marks only where a specific product is discussed; check the brand's guidelines first. |

## Layout (episode compositions)

`src/theme.ts` defines the canvas (1080 × 1920), colours and safe areas: chapter chips at y = 96, a stage at y = 190 to 1110, a lower band from y = 1140 (the SQL console in `tables-lab` sits there from x = 290), captions at y = 1520, and the bottom ~380 px kept clear of platform UI. The earlier robot presenter was removed (`archive/rejected-presenter/`), so the left of the lower band is empty. This geometry is fixed per scene; adaptive layouts are part of the plan in `docs/studio/`.

Fonts come from the system stack in `src/theme.ts` (SF Pro, then Inter, then generic sans). Renders can therefore differ between machines or macOS versions until fonts are loaded from tracked files (planned, Phase 3).

## Other work in this repository

* `prototypes/pip-scene-10x-v1/`: the first integrated prototype (Qwen voice, Pip rig, Remotion scene). **Frozen; do not edit.** It has its own `MANIFEST.json` with checksums and reproduction steps. The live code behind it (`src/art/pip-scene/`, `scripts/pip_scene_*.py`, composition `pip-scene-10x`) stays in place.
* `reference/pip-voice/approved-v1/`: the approved voice reference. Read-only.
* `src/art/`: art and mascot experiments (the `art-*` compositions).
* `archive/`: rejected experiments, kept for reference.

## Generated media and git

Approved source material is tracked: episodes, sources, `reference/`, `public/assets/`, `tests/fixtures/`. Newly generated media (`*.mp4`, `*.wav`, `*.mp3`, `*.webm`, `*.mov`, `*.m4a`, `*.flac`) is ignored by `.gitignore` so it stays out of ordinary history; the plan is to protect it with explicit project backups (Phase 1). Media committed before this policy remains tracked. Until the backup tool exists, nothing protects ignored media except your own copies.
