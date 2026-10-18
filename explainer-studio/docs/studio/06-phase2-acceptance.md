# Phase 2 acceptance results

Job runner, audio worker, render worker, timeline wrapper, alignment evaluation. No UI and nothing from Phase 3 on. Measured facts are marked **measured**; things I judged by eye or read from output are marked **judged**.

## What was built

| Piece | File | Notes |
|---|---|---|
| Schema v2 for jobs | `core/db.ts` | `jobs.lane`, `jobs.params_json`, `jobs.attempts`; tables `job_attempts`, `job_procs`, `job_events` |
| Process ownership | `core/proc.ts` | Identity is pid plus the process start time from `ps`; descendants are found by parentage, never by name or process group; unreadable `ps` means "unconfirmed" and nothing unverified is killed |
| Worker protocol and model host | `core/worker.ts` | JSON lines; one model at a time; unload, confirm, or kill and confirm |
| Runner | `core/runner.ts` | Persistent queue, one heavy job at a time, light lane, attempts, truthful progress, memory guard, cancel, auto-retry of a worker crash once, restart recovery |
| Handlers | `core/handlers.ts` | `tts.block`, `timing.build`, `mix.draft/final`, `render.draft/final`; each reads only its job snapshot |
| Audio worker | `workers/audio_worker.py` | Qwen3-TTS Base with the approved Pip reference, Qwen3-ForcedAligner, labelled estimate; offline, pinned revisions only |
| Mix | `workers/mix.py` | Places takes on the planned layout, 48 kHz mono; final adds loudness mastering |
| Render worker | `workers/render-worker.ts` | Bundles with an isolated public directory, renders with Remotion, reports real frame progress |
| Timeline wrapper | `pipeline/timeline_cli.py`, `core/timeline.ts` | Calls `build_timeline` unchanged; layout, timing assembly and labels live in TypeScript |
| Generic composition | `src/Root.tsx` (`studio-episode`) | Everything arrives as input props and a job-specific public directory |

## Acceptance criteria

| Criterion (from [05](05-implementation-plan.md#phase-2--job-runner-audio-worker-render-worker-l)) | Result | Evidence |
|---|---|---|
| Selective regeneration | **Pass with a fake worker; cache hits confirmed with the real worker.** Editing one sentence in a multi-block episode regenerates exactly that block; the others are cache hits, counted from job records and from which jobs reached the model. With the real model, a second pass over both blocks was two cache hits of 0.1 s each, no model load. A real edit-and-regenerate was not run. | `tests/store/handlers.test.ts`; integration report `cacheCheck` |
| Timeline wrapper equals the Phase 0 golden | **Pass for the full episode** (v2 document, Kokoro timings, through the wrapper, equals the golden `timeline.full.json`). The preview golden is still pinned by the Phase 0 Python test of the logic itself; it was not repeated through the wrapper. The wrapper contains no timing arithmetic (tested). | `tests/store/timeline.test.ts` |
| Unload transition 1: worker that holds known memory | **Pass.** The hand-over records the reply and a measured drop in resident size before the render enters Running. | `runner.test.ts`, "model host" |
| Unload transition 2: worker that ignores `unload` | **Pass.** Terminated, exit confirmed, then the render starts. Also for a worker that ignores SIGTERM. | same |
| Unload transition 3: worker that cannot be stopped | **Pass.** The render fails while Preparing with a reason, the heavy slot is free, and the next job runs. | same |
| Unload transition 4: real Qwen worker | **Pass, with a finding (below).** Measured twice in the integration run. | integration report `handovers` |
| Cancellation | **Pass.** A render and an audio job are cancelled; the worker, its children, and grandchildren stop, including a child that moved to its own process group; look-alike processes survive; no partial file or workspace is left; the next heavy job starts at once. | `runner.test.ts`, `handlers.test.ts` |
| Restart recovery | **Pass.** After `kill -9` of the runner process, reopening the project stops the leftover workers, marks the job failed (interrupted), frees the slot, and Retry works. | `runner.test.ts` |
| Lane rule | **Pass.** Many queued jobs run strictly one heavy job at a time in queue order; light jobs run beside it but never take its slot. | `runner.test.ts` |
| Alignment spike | **Done; decision below.** | [Alignment evaluation](#alignment-evaluation) |
| Timing source labels flow into the output | **Pass.** `source` (`qwen-aligned`, `qwen-estimated`, `qwen-mixed`) and per-segment `timingSources` are in `timeline.json`; the schema Remotion uses accepts them. | timeline tests; integration `timeline.json` |

Test totals at the end of the phase: 306 TypeScript tests and 30 Python tests pass, `tsc --noEmit` is clean, and no stray processes remain. The runner, handler and recovery suites also pass with a deliberately blocked `ps` on PATH (53 run, 18 skipped because they need to inspect processes; nothing fails open). The fake-worker tests use no models.

### Finding: resident size does not show model memory

On this machine MLX buffers are largely invisible to `ps` resident size. Before the first hand-over in the integration run the TTS model held 4.62 GB according to MLX while the worker's resident size read 35 MB. The hand-over therefore also records what the framework itself reports before and after unload (`mlxBeforeBytes`, `ack.activeBytes`), and confirms release from both. Measured: TTS to aligner, MLX 4.62 GB to 0.28 MB; aligner to render, MLX 1.84 GB to 0.49 MB and resident size 2.05 GB to 0.21 GB. The runner's own sampler records resident size of owned processes (browser included); it is a floor for the TTS worker, not its true footprint.

## Controlled integration (real narration, real alignment, real render)

**Scene.** "The existing scene" is read as the existing `join-fanout` preview `join-multiplication` (segments s04 to s07, the table lab), narrated with the approved Pip voice instead of Kokoro and rendered through the generic composition. The bespoke `pip-scene-10x` composition is a one-off whose timings are hard-coded; recreating it as data is Phase 3. Say so if you meant that one.

**Setup.** Temporary project (deleted afterwards), two blocks (s04+s05 with a 0.4 s gap, then s06+s07), the approved reference copied into the project's blob store (checksum verified before use and unchanged after), default seed 11, draft render.

| Stage | Wall time (measured) | Notes |
|---|---|---|
| Narration, block 1 | 30.5 s | 7.52 s of audio, generation 8.5 s (real-time factor 1.13), model load included |
| Narration, block 2 | 28.0 s | 8.00 s of audio, generation 9.5 s (1.18) |
| Timing | 19.6 s | Unload TTS, load aligner, align both blocks (0.4 s), build timeline |
| Mix (draft) | 0.8 s | 17.82 s, 48 kHz, narration only |
| Render (draft) | 14.7 s | 535 frames, 1080 × 1920, h264 + aac, 1.39 MB, concurrency 2 |
| Narration again | 0.1 s each | Both cache hits; no model load |

Output: `out/phase2/integration/pip-join-multiplication-draft.mp4` (ignored by git; 17.835 s), with `timeline.json`, the takes, the mix, and `integration-report.json`.

**Checks on the output.**

* **Measured:** the video is 1080 × 1920, 30 fps, 17.833 s, with a 48 kHz AAC track of 17.835 s; the timeline says 17.82 s.
* **Measured:** speech in the MP4's own audio against the timeline (energy detection, so lossy AAC adds a few ms): segment starts 0.85 / 5.28 / 8.62 / 11.95 s against 0.82 / 5.22 / 8.58 / 11.94 s; segment ends 4.86 / 7.96 / 11.71 / 16.33 s against 4.90 / 7.94 / 11.70 / 16.34 s. All within 60 ms.
* **Judged by eye:** four sampled frames show the correct captions for the moment and the table animation in step with them. Nothing was listened to; whether the voice sounds right was decided when the reference was approved, not here.
* The status report shows timing, mix and render fresh; the final mix and final render are not built.

**Resource use (measured, 16 GB machine).**

| Quantity | Value |
|---|---|
| MLX peak during narration | 8.36 GB and 8.64 GB (matches the earlier 8 to 8.6 GB runs) |
| Worker resident size (`ps`) | peak 1.95 GB while the aligner was loaded; 0.7 GB during block 1 (underreports, see above) |
| Browser and render process tree, resident peak | 2.2 GB |
| System memory pressure | level 4 (critical) in two of the 2 s samples, both during the first block, never more than 1 in a row; the guard needs 5 in a row, so nothing was stopped. Level 1 afterwards |
| Swap | 2.9 GB in use before the alignment run started; up to 9.3 GB in use during narration; 6.9 GB in use after the run |
| Peak MLX memory, aligner | 2.76 GB (1.84 GB active after load) |

The machine was already swapping before the run. The first block is where it hurts: the 1.7 B TTS model peaks near 8.6 GB on a 16 GB machine that also runs an editor and a browser. This is the known cost of the model, not something the runner added.

## Alignment evaluation

**Model.** `mlx-community/Qwen3-ForcedAligner-0.6B-bf16`, Apache-2.0, 1.84 GB, revision pinned to `53c8c0e46733eec430e4b53dd6471d0e5dee45f8`; loads through the installed `mlx-audio` 0.5.9 with no new package. The worker loads it only from the local cache at the pinned revision and never downloads.

**Memory and speed (measured, alone in the process).** Load 1.7 s; 1.84 GB active; peak 2.76 GB during alignment; align 1.7 s for the first 11.7 s take (includes warm-up), 0.14 s for the next; unload confirmed released (MLX 0.2 MB afterwards, resident 0.2 to 0.3 GB). It never shared memory with the TTS model.

**Resolution.** The aligner works on an 80 ms grid (about 2.4 frames at 30 fps); every time it returns is a multiple of 0.08 s.

**Error against reference boundaries.** Two kinds, different strength, both on the two existing Pip takes (11.7 s and 11.3 s, seven segments each):

1. **Segment starts and ends against an independent acoustic measure** (energy envelope, threshold −35, −40, −45 dB; not human labels; **measured**). Take `seed11`, all 14 segment boundaries: mean absolute error 24, 20 and 46 ms at −35, −40 and −45 dB; worst 55, 45 and 260 ms (at −45 dB the envelope's own end estimate drifts into low-level tail noise, so that setting says more about the reference than about the aligner). Take `seed7`: no usable reference: the envelope does not separate two of its sentences (a 240 ms gap holds low-level noise), so the two methods segment that take differently. Not reported as a number.
2. **Word onsets inside sentences against marks I read by eye from spectrograms** (18 onsets of 28 words in `seed11`, recorded in `tests/fixtures/alignment/seed11-hand-marks.json` before the comparison; **judged**, reading uncertainty about ±25 ms; marked by the assistant, not by a human listener). Aligner: mean absolute error 21 ms, worst 50 ms, mean signed −15 ms (it places onsets slightly early; a stop's closure is counted into the word). Labelled estimate (below): mean 31 ms, worst 156 ms; on the 12 non-sentence-initial words 45 ms mean.

The spectrograms (aligner red, estimate blue, speech runs green) are in `out/phase2/align-eval/` and regenerate with `scripts/phase2_align_report.py`.

**The estimate.** If the number of silence-separated speech runs equals the number of segments, each segment gets its run; otherwise all words share the whole detected span. Words share their span by length. On this material it is closer than expected because the sentences are short and separated by pauses. It stays as the labelled fallback (`estimated`).

**Decision: adopt the aligner as the default.** It is about twice as accurate inside sentences and much more robust in the worst case, costs 1.7 s to load, and its worst observed error (50 ms) is about 1.5 frames. Errors are small against the 80 ms cue lead already in the timeline logic, but the evidence is thin: one take hand-checked, 18 marks, one reader, no listening. The label `aligned` therefore means "produced by the aligner", not "verified". If a block cannot be aligned (token count mismatch), that block falls back to `estimated` and the timeline says `qwen-mixed`.

## Remaining limitations

* **Segment pauses inside a block are not applied.** A take is one continuous recording; `pauseAfter` on a segment inside a block does nothing. Gaps exist only between blocks (`gapAfterSec`, else the pacing default).
* **Manual timing corrections are hashed but not applied.** The component exists and invalidates timing; applying corrections needs the Phase 4 editor.
* **The mix is narration only.** Sound events, sound assets and mix parameters are hashed but not used; no accents are mixed.
* **The final mastered mix and final render were not run for real.** The final path is covered by the fake-worker tests and the mix script was exercised in draft mode with the real takes; loudness mastering (ffmpeg `loudnorm`, single pass) has not been measured on real takes. The draft mix measured −22.3 LUFS integrated, −3.7 dBFS peak, as expected for unmastered output.
* **Resident size cannot see MLX memory** (above). The memory guard uses system pressure, which is the right signal but coarse (2 s samples).
* **Pressure.** The TTS model briefly drives this machine to critical pressure and heavy swap. Close other heavy applications for narration runs; the guard stops a job after five consecutive critical samples.
* **Cache hits create a second artifact row** pointing at the same file; harmless, and cleanup keeps the file while any row references it.
* **Progress updates are written at most every 250 ms per step**, so the final fraction of a very fast render may not be stored; the terminal state is.
* **One take per block, seed 11.** There is no UI to re-roll; a different seed is a job parameter.
* **Verification is thin where noted:** hand marks by one reader without listening; one real scene; draft render only.
* **Not done and not part of this phase:** `init`/`adopt` on the real studio (still paused), any UI, scene library, fonts.

## Plan changes

1. Hand-over confirmation uses the framework's own counters as well as resident size (finding above). Plan item 4 of the unload acceptance is satisfied on that basis.
2. `render.*` takes everything from input props and an isolated public directory, via a new composition `studio-episode`, instead of the repository's `public/generated` and `src/generated/manifest.json`. The legacy `./studio` render path is unchanged.
3. The timeline `source` enum gained `qwen-aligned`, `qwen-estimated`, `qwen-mixed`, and the timeline gained optional `timingSources`. Existing timelines are unaffected.
4. Segment `pauseAfter` inside a block and sound accents are deferred (above); the Phase 4/5 editor work should decide how block-internal pauses are expressed.

## How to reproduce

```sh
npm test                                              # TypeScript and Python tests, fake workers only (no models)
npx tsc --noEmit
node scripts/phase2_align_eval.ts                     # loads only the aligner; writes out/phase2/align-eval/results.json
.venv-qwen/bin/python scripts/phase2_align_report.py  # errors, spectrograms
node scripts/phase2_integration.ts                    # real narration -> timing -> mix -> render in a temporary project
```

The integration and evaluation scripts need the cached Qwen models and 16 GB of memory headroom; they never download.
