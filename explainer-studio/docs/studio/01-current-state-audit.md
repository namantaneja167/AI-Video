# 01 · Current-state audit

Scope: what exists in `explainer-studio/` today, classified as **Working**, **Experimental** or **Missing**. Statements marked *(measured)* were checked by running a command; statements marked *(judged)* rest on listening or looking and are not objective.

## Preserved prototype

`prototypes/pip-scene-10x-v1/` is frozen and read-only (34 files, `MANIFEST.json` with SHA-256s, reproduction steps, known limits). It contains `pip_scene_10x_v1.mp4`. The live code that produced it stays in place and is treated as working production code:

| Piece | Path |
|---|---|
| Composition and rig | `src/art/pip-scene/PipScene10x.tsx`, `rig.ts` |
| Narration (Qwen Base, approved reference) | `scripts/pip_scene_narration.py` |
| Timing/envelope analysis | `scripts/pip_scene_timing.py` |
| Memory monitor | `scripts/qwen_mem_monitor.sh` |
| Approved voice reference (read-only) | `reference/pip-voice/approved-v1/` |

Re-rendering from the live code reproduces the preserved MP4 at the checked frame (frame 170, PSNR 39.18 dB) *(measured)*. That is a spot check, not a full-video comparison.

## A. Working pipeline features (Kokoro-era, join-fanout)

| Feature | Evidence |
|---|---|
| Episode schema (zod) and validation | `src/schema.ts`, `scripts/validate.ts`; `./studio check` |
| CLI: `check`, `narrate`, `import`, `render`, `verify`, `new` | `./studio`, `studio.py` |
| Per-segment narration cache | Re-narrate of a cached episode takes about 4 s *(measured)* |
| Timeline builder | `pipeline/timeline.py` |
| Import path for externally written scripts | `./studio import` |
| Verify suite | Passes on the join-fanout preview. On the **full** episode it reports 2 failures *(measured, Phase 0)*: caption "So when a" (s17) is on screen for 0.275 s against a 0.3 s limit, and the full MP4 has never been rendered. The first is pinned as a known finding in the tests; it is a content decision, not fixed. |
| Remotion render of three scene types | `src/scenes/*`, `src/Episode.tsx` |

## B. Experimental

| Area | Notes |
|---|---|
| `src/art/*` | 13 `art-*` compositions, `pip/`, `pip2/`, `pip-layers/` reconstruction, JoinFrame/JoinMotion, PresenterConcept, ContactSheet. Warm-paper visual system (`art/palette.ts`, `parts.tsx`). |
| Qwen3-TTS scripts | Audition, consistency, narration. Working but not connected to `./studio`. |
| `pip-scene-10x` composition | Hand-authored 16.3 s scene: keyframe tracks and `perform()` in `rig.ts`. Not data-driven. |
| Kokoro voices | Rejected and archived. |

## C. Missing app functionality

*Status after Phase 1:* items 2 (project store, autosave, revisions, recovery) and 6 (invalidation) now exist in `core/` and are tested on temporary projects; the stale-render gap below is closed for outputs recorded through the store. The UI, job runner, Qwen integration, layouts, scene library, import flow and export are still missing.

| # | Gap | Consequence |
|---|---|---|
| 1 | No app or UI | Everything is CLI plus hand-edited JSON. |
| 2 | No project store, autosave, revisions or crash recovery | An edit is a file overwrite; no history, no restore. |
| 3 | No job runner (queue, progress, cancel, retry, memory scheduling) | Long jobs run as detached shell commands with a CSV memory log. |
| 4 | Qwen not integrated into the pipeline | Narration is a script with hard-coded text and seed choice. |
| 5 | No block-level takes or cache for Qwen | One whole-scene pass; any text edit means re-running everything. |
| 6 | No invalidation graph | See finding below. |
| 7 | Review notes are text + resolved flag only | No timestamp, anchor, rounds or type. |
| 8 | No ChatGPT research/script import flow | `./studio import` takes the internal format only. |
| 9 | No layout system | See finding below. |
| 10 | No scene library or registry | Scenes are components wired by hand; custom work is mixed with reusable work. |
| 11 | No tests or lint | `verify` checks a render, not the code. **Phase 0 added 84 tests** (54 TypeScript, 30 Python); there is still no lint. |
| 12 | No export step | No loudness master, SRT/VTT, thumbnails or source package. |
| 13 | Doc drift | README was stale (presenter, layout, Node version) and `episodes/_template` was invalid against the schema (`__EPISODE_ID__` is not a legal id). **Both repaired in Phase 0**, with tests that guard against recurrence. |
| 14 | Two visual systems | Dark theme (`theme.ts`) and warm paper (`art/`). |
| 15 | No policy for binary artifacts in git | Phase 0 wrote one (generated media ignored from now on; approved sources tracked). History already contains 38 media files, from the commit that recorded the prototype work; they were not rewritten or untracked. |
| 16 | Remotion licence not reviewed for distribution | See architecture risks. |
| 17 | Undeclared dependencies | `verify` imports `num2words`, which was missing from `requirements.txt`; the Qwen environment had no requirements file; Remotion renderer, bundler and player were used only transitively. **Declared in Phase 0** (a test now compares imports with the requirement files). |
| 18 | Fonts depend on the machine | `theme.ts` starts its font stack with SF Pro, supplied by macOS. Renders can change with the OS; nothing checks that a font loaded. Planned for Phase 3. |

### Finding: stale renders are invisible *(measured)*

`out/join-fanout-preview-join-multiplication.mp4` was rendered at 20:31. `src/Episode.tsx` was last changed at 21:46 and the presenter component is no longer imported anywhere in `src/Episode.tsx` or `src/scenes/`. The old MP4 still shows the previous presenter, `verify` passes, and nothing in `studio.py` compares artifacts with their inputs. This is the concrete case behind the invalidation requirement.

### Finding: the layout is fixed *(measured, current-code still)*

A fresh still of join-fanout at 36.7 s, rendered from the current code, shows the dense two-table scene filling the upper two thirds. No mascot is in the frame. The SQL console occupies the right of the lower band, and the area to its left is empty: that is where the old presenter stood. The prototype scene works the other way: the mascot is large and fixed, and content is limited to the space above it. Neither can trade space between them. Mockup frames in this folder are that real still with the mascot composited in for illustration only.

## What the audit means for the plan

* Keep: the schema idea, the `./studio` CLI, the timeline logic, the Qwen scripts, the Remotion compositions.
* Replace by migration, not rewrite: the per-variant manifest hack and the hand-wired scenes.
* Add: storage, jobs, invalidation, layouts, UI. Details in [02](02-product-spec.md) to [05](05-implementation-plan.md).
