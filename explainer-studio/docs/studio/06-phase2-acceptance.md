# Phase 2 acceptance results

Job runner, audio worker, render worker, timeline wrapper, alignment evaluation, and the closeout of the gaps found after the first Phase 2 report. No UI and nothing from Phase 3 on. **Measured** means a tool computed it from a file or run; **judged** means a person (here, the assistant) looked and decided; **not verified** means nobody has checked it yet.

## What was built

| Piece | File | Notes |
|---|---|---|
| Schema v2 for jobs | `core/db.ts` | `jobs.lane`, `jobs.params_json`, `jobs.attempts`; tables `job_attempts`, `job_procs`, `job_events` |
| Process ownership | `core/proc.ts` | Identity is pid plus the process start time from `ps`; descendants are found by parentage, never by name or process group; unreadable `ps` means "unconfirmed" and nothing unverified is killed |
| Worker protocol and model host | `core/worker.ts` | JSON lines; one model at a time; unload, confirm, or kill and confirm |
| Runner | `core/runner.ts` | Persistent queue, one heavy job at a time, light lane, attempts, truthful progress, memory guard, cancel, auto-retry of a worker crash once, restart recovery, enqueue-time rejection of unsupported inputs |
| Handlers | `core/handlers.ts` | `tts.block`, `timing.build`, `mix.draft/final`, `render.draft/final`; settings come only from the job snapshot; executed files are verified against what was recorded |
| Recorded inputs and verification | `core/toolchain.ts`, `core/support.ts` | Fingerprints of workers, mix script, timeline logic, render sources and versions; list of inputs this build cannot apply |
| Audio worker | `workers/audio_worker.py` | Qwen3-TTS Base with the approved Pip reference, Qwen3-ForcedAligner, labelled estimate; offline, pinned revisions; verifies the revision and library versions the caller recorded |
| Mix | `workers/mix.py` | Places takes on the planned layout, applies `voiceGainDb`, 48 kHz mono; final adds loudness mastering |
| Render worker | `workers/render-worker.ts` | Bundles with an isolated public directory, renders with Remotion, reports real frame progress |
| Timeline wrapper | `pipeline/timeline_cli.py`, `core/timeline.ts` | Calls `build_timeline` and `filter_for_preview` unchanged; layout, timing assembly and labels live in TypeScript |
| Generic composition | `src/Root.tsx` (`studio-episode`) | Everything arrives as input props and a job-specific public directory |

## Acceptance criteria

| Criterion (from [05](05-implementation-plan.md#phase-2--job-runner-audio-worker-render-worker-l)) | Result | Evidence |
|---|---|---|
| Selective regeneration | **Pass with a fake worker; cache hits confirmed with the real worker.** Editing one sentence regenerates exactly that block; the others are cache hits, counted from job records and from which jobs reached the model. With the real model a second pass over both blocks was two cache hits of 0.1 s. A real edit-and-regenerate was not run. | `handlers.test.ts`; first integration report |
| Timeline wrapper equals the Phase 0 golden | **Pass for the full episode and for the preview** (v2 document, Kokoro timings, through the wrapper; the preview is narrowed by the Python `filter_for_preview`). The wrapper has no timing arithmetic (tested). | `timeline.test.ts` |
| Unload transition 1 to 3 (fake workers) | **Pass.** Known memory is measured to drop before the render starts; a worker that ignores `unload` or SIGTERM is killed and its exit confirmed first; a worker that cannot be stopped fails the render in Preparing with the slot free. | `runner.test.ts` |
| Unload transition 4: real Qwen worker | **Pass, with a finding (below).** Measured in three real runs. | `validation-report.json` `handovers` |
| Cancellation | **Pass.** Worker, children and grandchildren stop, including a child in its own process group; look-alikes survive; no partial file; the next heavy job starts at once. | `runner.test.ts`, `handlers.test.ts` |
| Restart recovery | **Pass.** After `kill -9`, reopening stops the leftover workers, marks the job failed (interrupted), frees the slot; Retry works. | `runner.test.ts` |
| Lane rule | **Pass.** | `runner.test.ts` |
| Alignment spike | **Done; decision below.** | [Alignment evaluation](#alignment-evaluation) |
| Timing source labels in the output | **Pass.** `qwen-aligned`, `qwen-estimated`, `qwen-mixed` and per-segment `timingSources`. | timeline tests; `timeline.json` |

### Finding: resident size does not show model memory

MLX buffers are largely invisible to `ps` resident size. Before the first hand-over of the first integration run the TTS model held 4.62 GB according to MLX while the worker's resident size read 35 MB. The hand-over therefore also records what the framework reports before and after unload (`mlxBeforeBytes`, `ack.activeBytes`), and confirms release from both.

## Closeout: queued jobs run on what was recorded

**Problem.** After the first report, final mixing read the mastering targets, and rendering read the render settings, from the project's current state at run time. A job queued under one set of inputs could silently run on newer settings, while its output carried the old input hash.

**Fix.** A job snapshot now stores the plain-value settings as they were at enqueue (`componentValues`; file-set components are already pinned by their manifest hash and blobs). Every handler reads settings only from the snapshot, checks each against its recorded hash, and records what it actually used in the artifact metadata (`meta.used`). A job whose recorded inputs are missing or were written by an older build refuses with an explanation and never substitutes anything.

| Input | Recorded as | At run time | If it differs |
|---|---|---|---|
| Voice settings: model, revision, library versions, generation limit (`max_tokens`) | `voiceRuntime` value in the snapshot | Passed to the worker, which checks the pinned revision and installed versions | Worker refuses |
| Approved reference audio and exact transcript | Hashes in `voiceRuntime`; the reference itself is immutable by name | Hash of the reference audio and of its transcript compared | Job refuses before the model loads |
| Audio worker script | Hash in `voiceRuntime` | Hash of the script actually executed | Job refuses |
| Aligner id and revision | `aligner` value | The worker is asked once to confirm the revision | The whole timing job refuses; it does not fall back to the estimate (a block that fails to align for another reason is labelled `estimated`) |
| Mastering targets, `voiceGainDb` | `masteringParams`, `mixParams` values | Used from the snapshot | n/a (the recorded values are the ones used) |
| Mix script | Hash in `mixParams` | Compared | Job refuses |
| Timeline logic (`timeline.py`, `timeline_cli.py`, `core/timeline.ts`) | Per-file hashes | Compared | Job refuses |
| Selected takes, timing, mix | Blob hashes in the snapshot | Blob must exist | Job refuses; nothing is regenerated |
| Render settings | `renderSettings` value | Validated (1080 × 1920, 30 fps, h264 + aac, `crf`); anything else is refused, not ignored | Job refuses |
| Render sources: all of `src/` except `src/generated/`, `package.json`, `package-lock.json`, `tsconfig.json`, `remotion.config.ts`, the theme file, `public/assets/**` | File-set manifests (the files are copied into the project) | Every recorded file hashed in the working checkout; added files detected | Job refuses, naming the files |
| Remotion and renderer versions, render worker script | `versions` | Installed versions and script hash compared | Job refuses |

Blobs: cleanup now also keeps the snapshot blobs of failed and cancelled jobs (they can be retried on the same inputs). Consequence: those blobs stay until jobs can be discarded, which has no feature yet.

**Evidence.** `handler-inputs.test.ts` (22 tests) queues a job, changes the relevant setting, lets the job run, and checks that the recorded value was used, the output is `outdated` and never current, and freshness and provenance are accurate. Covered: mastering targets, voice gain, render settings (including a retry after a failure), aligner configuration and a worker whose recorded revision does not match, reference and voice runtime (what the worker was actually sent), executed scripts, timeline logic fingerprint, source file edited / added / reverted, asset changed, installed Remotion version changed, unsupported render settings, a take blob removed, a snapshot from an older build, a missing document blob, cleanup keeping a failed job's blobs. Four deliberate breakages of the safeguards (live mastering read, no source check, no input guard, no reference check) were each caught by the intended test.

## Closeout: unsupported inputs are rejected, not ignored

Checked before a job is queued (and again by each handler from its own snapshot, before any model loads). Ordinary supported episodes are unaffected.

| Input | Phase 2 behaviour |
|---|---|
| Manual timing corrections | **Not applied; a non-empty setting is rejected** (needs the Phase 4 timing editor and a defined format) |
| Pause on the **last** segment of a block | **Applied**: added to the silence after the block (after the last block: to the tail). It is part of the mix and timing hashes |
| Pause on a segment **inside** a block | **Rejected** with the fix (start a new block after that segment): a block is one continuous recording |
| Sound events, sound assets | **Rejected** (the mix is narration only; sound design is a later phase) |
| Mix parameters | **`voiceGainDb` (−24 to 12) is applied; any other parameter is rejected** |
| Block `gapAfterSec` | Applied (on the last block it replaces the pacing tail) |

Effect on real data: `join-fanout` has one pause (`s07`, 0.3 s) in the middle of its second block. As authored it is now rejected for Qwen production, with the instruction to split the block after `s07`; the validation run uses the preview `s04`–`s07`, where `s07` ends its block and the 0.3 s pause is applied.

## Final production path (real narration inputs, real alignment, mastering and render)

Run through the real handlers in a temporary project (deleted afterwards): timing with the aligner, final mastered mix, final render. Narration was **not regenerated**: the saved takes from the earlier real generation (blocks `b1` and `b2`, seed 11, Pip voice, approved reference; SHA-256 `f87b1040c545…` and `19784002b9c7…`) were entered as ordinary takes whose metadata says where they came from. The scene is the existing `join-fanout` preview `join-multiplication` (s04 to s07, table lab), accepted for Phase 2. This is a technical pipeline test only. The author rejected its visual style; it is not a production baseline and no further samples of this kind are made. The creative baseline is `prototypes/pip-scene-10x-v1/` (see [05](05-implementation-plan.md#creative-baseline-and-how-phase-3-carries-it-proposed-awaiting-your-approval-before-any-phase-3-work)).

**Output:** `explainer-studio/out/phase2/final/PIPELINE-VALIDATION-SAMPLE_join-multiplication_final.mp4` (ignored by git), with `mastered-mix.wav`, `timeline.json`, `measurements.json` and `validation-report.json` beside it.

**Measured** (`scripts/phase2_measure.py`; targets −16 LUFS and −1.5 dBTP; tolerances chosen before the run and stated here):

| Quantity | Target | Tolerance | Measured | Result |
|---|---|---|---|---|
| Mastered WAV, integrated loudness | −16 LUFS | ±1.0 LU (loudnorm runs in one pass, approximate on short clips) | −16.4 LUFS (−0.4 LU) | within |
| Mastered WAV, true peak | −1.5 dBTP | at most +0.2 dB | −1.5 dBTP | within |
| Audio decoded from the final MP4, integrated loudness | −16 LUFS | ±1.0 LU (lossy AAC) | −16.4 LUFS (−0.4 LU) | within |
| Audio decoded from the final MP4, true peak | −1.5 dBTP | at most +0.5 dB (AAC overshoot) | −4.5 dBTP | within (see note) |
| Loudness range | none set | n/a | 2.5 LU | reported only |
| Lag between MP4 audio and mastered WAV | 0 | ±40 ms | 0 ms | within |
| Timeline segment starts and ends against speech in the decoded MP4 audio | exact | ±80 ms (energy detection plus AAC delay: a consistency check, not ground truth) | worst 55 ms (starts +30, +55, +40, +10 ms; ends −35, +25, +15, −10 ms) | within |
| MP4 duration against the timeline | 18.12 s | one frame (33 ms) | 18.133 s (+13 ms; 544 frames) | within |

Note on true peak: the MP4 audio is stereo (the renderer upmixes the mono mix), and each channel sits about 3 dB below the mono WAV, so the per-channel true peak is lower while integrated loudness, which sums the channels, matches. The measurement is conservative for the peak.

Other facts from the file (**measured**): h264, 1080 × 1920, 30 fps, yuv420p, 544 frames, 18.133 s; AAC, 48 kHz, 2 channels; 2.33 MB. The timeline source is `qwen-aligned` for all four segments (alignment 1.1 s). The file's SHA-256 is `1a0f8b528839e4e4a8387528373813a5b0a357f7ac4a5171100fe9fe0dd6eceb`; the run was repeated on the final code and gave identical measurements. Status after the run: timing, final mix and final render fresh.

**Resources (measured, 16 GB machine).** Stages: timing 2.8 s, final mix 0.9 s, final render 14.7 s. Aligner loaded 1.84 GB (MLX) and was unloaded with release confirmed before the render: MLX 1.84 GB to 0.2 MB, worker resident size 282 MB to 287 MB (resident size does not show MLX memory). Render process tree peak resident 2.1 GB. System memory pressure reached level 2 at most; swap in use up to 4.6 GB (the machine was already swapping). Narration was not run, so there is no new TTS peak; the earlier run measured 8.4 to 8.6 GB.

**Judged:** four sampled frames show the right captions for the moment and the table animation in step with them. **Not verified:** anything about how the narration sounds, whether every word was spoken, how the pauses (0.4 s between blocks, 0.3 s after s07) feel, or how it looks on a phone. See [What needs your listening and viewing](#what-needs-your-listening-and-viewing).

## First integration run (before the closeout)

The earlier draft run (real narration for the same two blocks, aligner, draft mix, draft render; `out/phase2/integration/`) predates the closeout changes and is kept as history. Measured then: narration 30.5 s and 28.0 s (real-time factor 1.13 and 1.18; MLX peak 8.36 and 8.64 GB), timing 19.6 s, draft mix 0.8 s, draft render 14.7 s, cache hits 0.1 s each, and a memory pressure that reached critical in two single 2 s samples during the first block (the guard needs five in a row) with swap up to 9.3 GB. The first TTS-to-aligner hand-over released 4.62 GB (MLX) in 0.24 s.

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

## Reproducibility: what is guaranteed and what is not

**Verified before each job runs, and the job refuses otherwise:** every setting above (taken from the snapshot); the reference audio and transcript; the executed audio worker, mix script, render worker and timeline logic files; every render source file listed above, including additions; the installed Remotion and renderer versions; the worker's pinned model revisions and library versions (the check refuses on a mismatch of revision, `mlx-audio` or `mlx`; it was exercised directly against the real worker code with matching and mismatching values, and in the real run for the aligner revision; the TTS generation path with it was not run for real because narration was imported).

**Not isolated. Render sources are read from the working checkout and verified, not copied into the job:**

* A file changed after verification but before the bundler reads it (a window of seconds) would not be detected.
* Dependencies other than Remotion and the renderer (React, the bundler's dependencies, other `node_modules` contents), the Chrome Headless Shell version, system fonts, and the versions of Python, numpy, scipy, Node and ffmpeg are recorded in part (`versions` holds Node and ffmpeg) but not compared at run time.
* Files imported by the scripts but not listed (for example other modules in `core/`) are not fingerprinted, and neither is `core/handlers.ts` itself: the draft render quality (`crf` 28) is a constant in that file, not a recorded setting.
* Narration is stochastic across library and hardware versions; reproducibility rests on keeping the saved takes, which are preserved as blobs.
* Fonts: the composition uses the system font stack; a different machine or macOS version can render different text shapes.
* Snapshot blobs of failed and cancelled jobs are kept until those jobs can be discarded.

## Remaining limitations

* **Manual timing corrections are not supported** (rejected), **nor are sound events, sound assets, mix parameters other than `voiceGainDb`, and pauses inside a block** (rejected, with the fix for the last).
* **A real edit-and-regenerate with the real TTS model was not run**; selective regeneration is proven with fake workers, cache hits with the real worker.
* **Final mastering is single-pass `loudnorm`**: within the stated tolerance on this sample (−0.4 LU), but approximate in general. A two-pass mode would be tighter; not needed for this sample, so not built.
* **Resident size cannot see MLX memory** (above); the memory guard uses system pressure, which is coarse (2 s samples). The first narration block drives this machine to critical pressure and heavy swap; close other heavy applications for narration runs.
* **Cache hits create a second artifact row** pointing at the same file. Harmless.
* **Progress updates are written at most every 250 ms per step**; the final fraction of a very fast render may not be stored.
* **One take per block, seed 11**; a different seed is a job parameter, not a UI choice.
* **Alignment evidence is thin** (below the evaluation).
* **Not done and not part of this phase:** `init`/`adopt` on the real studio (still paused), UI, scene library, fonts, minimum-text-size and overflow checks, review sessions and approval sign-off recording.

## What needs your listening and viewing

Nothing in this phase was listened to, and none of the output is approved. Approval of the voice reference is not approval of these takes.

* **Listen** to the final MP4 from start to finish: is every word spoken and correct (alignment cannot prove a dropped word), does the voice sound natural and like Pip, are the pauses (0.4 s between blocks, 0.3 s after s07) and the overall pacing right, is the loudness comfortable.
* **Watch** it with sound on: do the table animation and captions land on the right words, does anything look wrong or distracting.
* **Watch at phone size**: is the text readable, is anything cut off.
* **Decide** whether the 18 hand marks and one hand-checked take are enough evidence for the aligner, or whether you want a human-labelled sample.

## Plan changes

1. Hand-over confirmation uses the framework's own counters as well as resident size.
2. `render.*` takes everything from input props and an isolated public directory, via `studio-episode`, instead of the repository's `public/generated` and `src/generated/manifest.json`. The legacy `./studio` render path is unchanged.
3. The timeline `source` enum gained `qwen-aligned`, `qwen-estimated`, `qwen-mixed`, and the timeline gained optional `timingSources`.
4. Job snapshots carry the plain-value settings; the dependency hashes of the mix and timing now include the pause of each block's last segment.
5. Segment pauses inside a block, manual timing corrections and sound design are deferred and rejected until a phase defines them (the Phase 4 and 5 editor work should decide how block-internal pauses are expressed).

## Verification

All of this ran in this session after the last code change.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` (TypeScript, then Python) | TypeScript: 330 tests in 48 suites, **330 pass, 0 fail, 0 skipped**. Python: 30 tests, OK |
| Store suites with a deliberately blocked `ps` on PATH | 268 tests: **245 pass, 0 fail, 23 skipped** (the skipped ones need to inspect processes; nothing fails open) |
| New in the closeout | `handler-inputs.test.ts` 22 tests; `timeline.test.ts` now 8 (preview golden and pause layout added) |
| Safeguard mutations | 4 deliberate breakages, each caught |
| Real final run | Measurements above; the temporary project and every process it started are gone |
| Untouched | `reference/pip-voice/approved-v1/` (checksum verified before and after), `prototypes/pip-scene-10x-v1/`, `episodes/`, `src/art`; no `.studio` folder in the real project |

## How to reproduce

From `explainer-studio/`:

```sh
npm test                                              # TypeScript and Python tests; fake workers only, no models
npx tsc --noEmit
node scripts/phase2_align_eval.ts                     # loads only the aligner
.venv-qwen/bin/python scripts/phase2_align_report.py  # alignment errors and spectrograms
node scripts/phase2_final.ts --import-takes out/phase2/integration   # timing, final mix, final render, measurements
node scripts/phase2_final.ts                          # the same, generating narration (needs memory headroom)
```

The scripts need the cached Qwen models and never download.
