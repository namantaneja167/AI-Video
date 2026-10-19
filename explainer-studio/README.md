# Explainer Studio

Local pipeline for faceless technical explainer videos: an episode JSON (script + storyboard you approved elsewhere) goes in, a 1080×1920, 30 fps narrated MP4 comes out. No LLM, paid API or browser automation is involved.

This directory holds two things, kept apart on purpose:

* **The Explainer Studio app** (`./studio-app`): a local browser app for the whole journey, from an idea to a reviewed, mastered video: idea, research, script, storyboard, scenes, voice, review (draft, final, production checks, notes, approval, export). Its project, recovery and setup guide is [below](#the-app); the specification, architecture, phase results and limits are in [`docs/studio/`](docs/studio/README.md) (the latest: [`docs/studio/14-phase8-hardening.md`](docs/studio/14-phase8-hardening.md)).
* **The legacy command-line pipeline** (`./studio`, `pipeline/`, `src/`), described further down. It keeps working unchanged.

```
episodes/<id>/episode.json ──► ./studio narrate ──► public/generated/<id>/<variant>/{audio.wav,timeline.json,episode.json}
                                                      │
                                       Remotion Studio (preview)  /  ./studio render ──► out/<id>-<variant>.mp4
```

## Install (once)

Requires macOS (Apple silicon for narration), Node 24 or newer (developed on 26.4), and the Homebrew packages `ffmpeg` and `python@3.12`.

```sh
brew install ffmpeg python@3.12
./setup.sh               # the exact locked Node packages (npm ci) and .venv (timing logic, numpy, soundfile, the legacy Kokoro tools)
./setup.sh --narration   # the same, plus .venv-qwen for narration (requirements-qwen.txt)
./studio-app doctor      # what is present, what is missing, and how to fix each thing
```

Nothing in setup downloads a voice model. The Qwen3-TTS narration model and the word-timing model live in the Hugging Face cache outside this folder, and are fetched only when you ask (`doctor` prints the command). The first video render or check downloads Remotion's headless browser once (`npx remotion browser ensure` does it ahead of time). The legacy Kokoro narration downloads its own model (~330 MB) on first use.

## The app

```sh
./studio-app new ~/Documents/my-explainers     # create a new, empty project in a new or empty folder, then open it
./studio-app open ~/Documents/my-explainers    # open it again later
./studio-app                                   # the seeded demo workspace (needs saved outputs this checkout may not have)
```

Then open the address it prints (it contains a sign-in token and only works on this computer). A project is an ordinary folder you choose, anywhere outside this checkout (or under `projects/` here, which git ignores). Creating never touches a folder that has anything in it, opening never creates, and this checkout itself is refused (adopting it is paused). One app per project at a time; close it with Ctrl+C.

**Making an episode.** New episode, then the steps along the top: Idea (a brief), Research and Script and Storyboard (you copy a brief to ChatGPT yourself and paste its answer back; the app only reads what you paste and shows it as *Proposed* until you accept it), Scenes (apply the storyboard, adjust cards, choose the typeface), Voice (generate narration with the approved Pip voice, re-roll, choose takes), then Review. In Review you make a draft video (unmastered, never approvable), write notes, make the final video (mastered), run the production checks, and only you can open a review round on the final, play it, tick the four confirmations, approve it and export it. The checks say what they measured, what is a rule of thumb, what was only partly checked and what only you can judge; they cannot hear a dropped word.

**The Project screen** (Settings in the left rail): where the project is, **Back up now**, how to restore, and what this computer has.

* A backup is a self-contained, checksummed folder written next to the project (`<project>-backups/`), verified after it is written: every episode and its history, selected takes, videos, notes, review rounds, check reports and the approval records, plus the approved voice reference. It does not contain `node_modules`, the Python environments, the voice models or exported packages.
* Restore into an empty folder, anywhere (stop the app first): `node scripts/project.ts restore <backup folder> <empty folder>` then `./studio-app open <that folder>`. It verifies every file first and leaves nothing behind if it stops. Nothing in a project refers to where it was.
* A new computer: install (above), restore, open. Models are fetched only when you ask.

**Requirements and expectations.** A 1280 x 800 window or larger (the layout was checked down to 900 x 700 without page scrolling). On an Apple silicon Mac with 16 GB, narration holds about 8 to 10 GB while it runs, so close memory-hungry apps before narrating; the app stops a job and says why if memory pressure stays critical. Measured on that machine, a 16 s episode: narration 18 s (first block, includes loading the model), a draft video 20 s, the final video 18 to 20 s, each set of production checks 9 to 11 s, the app starts in about 0.1 s. Longer episodes take roughly in proportion to their length; the app shows an estimate from what it has measured, or says "Not measured".

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
npm run test:slow      # real browser, renderer and ffmpeg: the app's screens end to end, probe and renders; a few minutes
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
node scripts/project.ts backup <dir> [--compact]              # self-contained, checksummed backup (complete; --compact leaves out draft videos)
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

Legacy dark episodes use the system stack in `src/theme.ts` (SF Pro, then Inter, then generic sans), so they can differ between machines. Pip episodes made in the app use the bundled fonts in `public/library/fonts` (Inter and JetBrains Mono, SIL OFL 1.1, checked against their manifest before every render); the system stack remains selectable per episode (Scenes, Typeface) for comparison with the original prototype.

## Other work in this repository

* `prototypes/pip-scene-10x-v1/`: the first integrated prototype (Qwen voice, Pip rig, Remotion scene). **Frozen; do not edit.** It has its own `MANIFEST.json` with checksums and reproduction steps. The live code behind it (`src/art/pip-scene/`, `scripts/pip_scene_*.py`, composition `pip-scene-10x`) stays in place.
* `reference/pip-voice/approved-v1/`: the approved voice reference. Read-only.
* `src/art/`: art and mascot experiments (the `art-*` compositions).
* `archive/`: rejected experiments, kept for reference.

## Generated media and git

Approved source material is tracked: episodes, sources, `reference/`, `public/assets/`, `tests/fixtures/`. Newly generated media (`*.mp4`, `*.wav`, `*.mp3`, `*.webm`, `*.mov`, `*.m4a`, `*.flac`) is ignored by `.gitignore` so it stays out of ordinary history; the plan is to protect it with explicit project backups (Phase 1). Media committed before this policy remains tracked. Until the backup tool exists, nothing protects ignored media except your own copies.
