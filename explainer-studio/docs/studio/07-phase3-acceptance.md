# Phase 3 acceptance: scene library, Pip performance as data, sound accents, layouts, fonts

Phase 4 (the app UI) has not started. Real-project `init`/`adopt` is still paused; every pipeline run below used a temporary project that the script created and removed.

## Status: three separate states

*Later note:* the author has since watched revision 2 and called it "clear and fun" (build `fa8d8a6b...`). That is visual feedback on that build, not a sign-off or approval, and the table below is unchanged: `15-creative-benchmark-and-review-records.md`.

**Built** means the code and the outputs exist. **Technically passing** means a tool measured it against a stated check in this session. **Human-approved** means you decided it by looking or listening. Nothing below is human-approved: no sign-off (`listened`, `watchedPhoneSize`, `customScenesReviewed`) was recorded, and nothing here says the narration sounds natural, the words are right, the video looks good or the fonts are chosen. Where I looked at frames I say what I saw; that is not approval.

| Item | Built | Technically passing (measured) | Human-approved |
|---|---|---|---|
| Final mix mastered as one voice-plus-accent mix to -16 LUFS / -1.5 dBTP | yes (revision 2) | WAV -16.0 LUFS, -1.7 dBTP; decoded MP4 -16.1 LUFS (section 3) | no: how the limiter sounds is yours to judge |
| The s6 boundary discrepancy (130 ms) | investigated | cause identified as the measurement, not the alignment or the placement; the audio was not shifted (section 4) | n/a |
| Phone-scale composition of the context-window scene | yes (revision 2) | fit check and tests pass at the raised text minimums; frames rendered (section 7) | no |
| The 8 -> 24 count made explicit | yes | visible in the rendered frames and the scene's tests; pieces, history and total are separate numbers | no |
| Bundled fonts (Inter, JetBrains Mono) kept for this revision | yes | font check passes; removing or altering a font fails it | no: the choice stays yours |
| Narration (approved Pip voice, saved takes reused) | unchanged from revision 1 | bit-identical takes (SHA-256 compared); aligned timing | no: needs your listening |
| Prototype reproduced through the new pipeline | yes | sections 2a to 2c | no |
| Phase 3 as a whole | yes | 362 TypeScript tests, 30 Python tests, 6 slow tests pass; `tsc` clean | **no: awaiting your review** |

## 1. What was built

| Area | Where | Notes |
|---|---|---|
| Scene registry, generic composition | `src/library/registry.ts`, `LibraryEpisode.tsx` | `studio-episode` now renders through `LibraryEpisode`. `style: legacy-dark` delegates to the unchanged `EpisodeVideo`; `pip-paper` and `pip-paper-bundled` render registered Pip scenes with the pipeline audio and the Pip caption pill. |
| Prototype scene as a custom scene | `scenes/Pip10xScene.tsx` | The existing `PipScene10x` component, unchanged (nothing under `src/art` or `prototypes/` was edited). |
| Performance as data | `pip/score.ts`, `pip/scores/prototype.ts`, `pip/scores/contextWindow.ts` | A score is tracks keyed to named cues, segment edges or absolute times, plus extras the prototype did not need: absolute position tracks (step aside, leave frame), a restrained idle, auto-blink. Mouth comes from the audio. The prototype's own score was generated from `rig.ts` by script and verified numerically. |
| Cue rules as data | `cues.ts`, `sceneSpecs.ts` | Node (the mix places accents) and the browser (the scene performs) read the same rules. |
| Sound accents and the final mix | `accents.ts`, `workers/accents.py`, `workers/mix.py`, `core/support.ts`, `core/deps.ts`, `core/handlers.ts` | The prototype's seven synthesizers only. Events: `cue` + `dt` or absolute `t`, `gainDb`, ranged `params`. In a final mix the accents are mixed with the voice first and the complete mix is mastered (section 3). Recorded in the job snapshot, in the mix's dependency hash (with the timing) and in the mix metadata. |
| Caption emphasis | `schema2.ts` (`emphasis` on a segment), `PipCaption.tsx`, `core/timeline.ts` | Plain caption text plus word ranges (`from`, `to`, `text`); out-of-range, overlapping or stale ranges are rejected with a message. |
| Styles | `schema2.ts` | `legacy-dark`, `pip-paper` (system font stack, the prototype's), `pip-paper-bundled` (Inter and JetBrains Mono). |
| Layouts and fit check | `layouts.ts`, `fit.ts` | `card-over-pip` (the prototype's), `content-led`, `dense-pip`. |
| Scenes | `scenes/ContextWindow.tsx`, `scenes/DenseFixture.tsx` | The sample's scene (revision 2 in section 7) and the dense fixture. |
| Fonts | `public/library/fonts/`, `fonts.ts`, `fontCheck.ts` | Section 6. |
| Tools | `scripts/phase3_*.ts|py` | Stills, parity, checkpoint (estimated or real timeline), controlled pipeline run, comparison, boundary analysis. |

## 2. Prototype reproduced

### 2a. Original timing, audio and authored performance (measured)

The frozen prototype scene, registered as a custom scene, was rendered through the new composition with the prototype's own `timing.json` and `scene_mix.wav`, and compared with a render of the live prototype composition and with frames of the preserved MP4. Fourteen representative frames: the start, one just after each major beat (card in, claim, sub, bars, notice, point, callout, callout text, contrast, palms, resolve 1, resolve 2) and the last frame.

* **Library render versus live render: identical on 14 of 14 frames** (PNG bytes identical; also a slow test). The 70 stills behind these comparisons were removed as regenerable (`node scripts/phase3_parity.ts --out <dir> --pipeline out/phase3/prototype-pipeline`, then `scripts/phase3_compare.py`); `compare.json` and the two sheets remain.
* **Live render versus the preserved MP4: PSNR 38.6 to 41.8 dB, median 40.05 dB** over the 14 frames (share of pixels differing by more than 8/255: 0.2 to 1.2 percent). This is the baseline distribution that H.264 compression and the MP4 pipeline produce for this scene. The library render sits in exactly that distribution because it is the same picture. No threshold was derived from the single frame-170 result (39.2 dB there, inside the distribution).
* Sheet for viewing: `out/phase3/parity-original/sheet-mp4-vs-library.png` (MP4 left, library right, four frames). Looking at it, I saw no difference between the columns; that is my observation, not your approval.

### 2b. Performance as data (measured)

For every one of the 489 frames of the prototype, the score's pose equals the original `perform()` output: largest absolute difference below 1e-9 (a pixel or a degree); same set of fields in every frame; the surprise burst is exercised. Tolerance rationale: both compute the same floating-point operations; the bound only covers offsets summed in a different order. A score that names a missing cue fails loudly.

The mouth track from `workers/mouth.py` on the prototype's raw narration take equals the prototype's `mouth` array exactly. The seven accent synthesizers reproduce the prototype's `scene_sfx_only.wav` to within 1 sixteen-bit step (18 events, same length).

### 2c. Produced by the pipeline (measured), with the alignment-caused differences

Same scene, same single narration take (`narration_seed11.wav`, imported as an ordinary take whose metadata says so), through the real forced aligner, cue rules, mouth worker, the complete-mix mastering of section 3 with the 18 prototype accents placed on cues, and the final render, in a temporary project. Output: `out/phase3/prototype-pipeline/`. The picture does not depend on the mix, so the frame comparisons below are unchanged by the mastering revision.

* Aligner 2.3 to 3.0 s; mix about 1 s; render 19 to 20 s; final video 1080 × 1920, 30 fps, 489 frames, 16.28 s timeline versus 16.30 s in the prototype (the pacing tail).
* **Cue times from aligned words versus the prototype's estimated words:** 18 cues, median difference 26 ms, largest 132 ms (`asterisk_pulse`, earlier). The timeline is identical across runs.
* **Frames from the pipeline timeline versus the live prototype:** the start and the end are identical; ten of twelve other frames are at 34 to 73 dB; two sit at 20.5 dB (`contrast`) and 22.3 dB (`palms`). Those two fall mid-transition, where cues moved by -20 ms and -52 ms, so the differences are caused by alignment timing and not by the library. Sheet: `out/phase3/parity-original/sheet-live-vs-pipeline-timing.png`.
* **Pipeline MP4 versus its own still renders:** 38.7 to 41.8 dB, median 40.02 dB: the same compression baseline as 2a.
* **Final mix, WAV:** -16.0 LUFS, true peak -1.6 dBTP, LRA 3.8 LU (target -16 LUFS, -1.5 dBTP). **Decoded MP4:** -16.0 LUFS. (The prototype's own mix measures -17.3 LUFS.)
* **Placement of segment boundaries against an unprocessed voice-only placement mix:** worst 45 ms (energy detector at -40 dB; sweep in section 4). Peak sampled worker memory 1.1 GB.

## 3. Final mix mastering (revision 2)

**What was wrong (measured, revision 1).** The final mix mastered the narration alone with a single-pass `loudnorm`, then added the accents (ducked under the voice) and scaled the whole mix down if the sum passed the ceiling. The narration landed at -16.9 LUFS, and adding accents after mastering moved the finished mix to -17.4 LUFS (the prototype run to -17.6), 1.4 to 1.6 LU under the target. Two things caused it: the order (the loudness of the finished file was never what was mastered, and the ducking and the peak guard changed it afterwards), and the voice's peak-to-loudness ratio (18.5 dB raw, against 14.5 dB available between -16 LUFS and -1.5 dBTP), so reaching -16 LUFS needs about 4 dB of peak reduction.

**What it does now (`workers/mix.py`, final mix only).**

1. The takes are placed; the accents are synthesised at the level they should have in the finished mix and ducked under the voice (as before).
2. The accents are scaled down by the gain that will be applied, so they end at their authored level (checked: the first accents measure 0.0 dB from authored in the finished mix).
3. The complete mix gets one gain and a look-ahead peak limiter (attack 5 ms, release 60 ms, sample-peak ceiling 0.3 dB under the true-peak target). The gain is solved by measuring the written file (a few passes); the written 16-bit file is then measured and, if its true peak were above -1.5 dBTP, the limiter ceiling would be lowered and the solve repeated. The limiter's delay is compensated (the voice stays sample-aligned: 0 samples).
4. The target (-16 LUFS), the ceiling (-1.5 dBTP) and the tolerances are unchanged. A signal below -60 LUFS is not mastered and says so.

**Dynamics control: what was compared** (saved narration and the 16 accents; the limiter and compressor variants all landed -16.0 LUFS and about -1.8 dBFS true peak):

| Variant | Raw voice LRA 2.9 LU becomes | Gain applied | How much it changes the speech |
|---|---|---|---|
| Limiter only, 5 ms / 60 ms (**chosen**) | 3.0 LU | 8.3 dB in the final run | peaks only: gain reduction averages 0.7 dB over active 5 ms windows; 26 percent of them more than 1 dB, 9 percent more than 3 dB, at most 6.0 dB |
| 2:1 compressor from -24 dB, then limiter | 2.6 LU | 12.6 dB | most of the speech: 78 percent of windows more than 1 dB, up to 10 dB |
| 3:1 compressor from -16 dB, then limiter | 2.8 LU | 10.0 dB | 55 percent of windows more than 1 dB |
| `loudnorm` two-pass on the complete mix | 3.3 LU | n/a | lands -16.5 LUFS with the true peak exactly at the ceiling |

I chose the limiter alone because it leaves the narrator's dynamics unchanged except at the peaks that would pass the ceiling. This is a measured trade-off, not a judgement of sound: a limiter working 6 dB on some peaks can be audible, and a compressor changes the body of the speech. Which sounds better is yours to hear; the settings are two constants at the top of the mastering function.

**Result (measured, revision 2, saved narration, real aligner, real render; `out/phase3/context-window-rev2/`).**

| | Target | Final WAV | Decoded MP4 |
|---|---|---|---|
| Integrated loudness | -16 LUFS (tolerance ±1.0 LU) | -16.0 | -16.1 |
| True peak | -1.5 dBTP (WAV tolerance +0.2 dB) | -1.7 (sample peak -1.8 dBFS) | -4.7 per channel |
| Loudness range | | 3.0 LU | 2.9 LU |

The decoded MP4 is the mastered mono mix duplicated into two identical channels, each 3.0 dB lower (WAV RMS -16.83 dBFS; each MP4 channel -19.85 dBFS, a difference of -3.02 dB; left minus right is zero), so its integrated loudness equals the WAV's while its per-channel true peak reads 3 dB lower. The WAV is the binding measurement of the ceiling. Audio and video lengths agree to 17 ms; the MP4 audio is 0 ms from the WAV. The prototype run: WAV -16.0 LUFS, -1.6 dBTP; MP4 -16.0 LUFS.

Tests: the mastering test masters the prototype's raw take with and without its 18 accents and asserts target within 0.2 LU, true peak at or below -1.5 dBTP, no compression, accents at their authored level (within 2.5 dB), and zero-sample alignment. Removing the accent scaling or removing the limiter each made it fail.

**Not claimed:** that the limited mix sounds as good as the unlimited one, or that -16 LUFS is the right level for this voice.

## 4. The 130 ms boundary discrepancy: cause

**Finding: the error is in the measurement, not in the alignment and not in the placement. Nothing was shifted.**

The check compares each timeline boundary (aligner word times) with where an energy detector (`scripts/phase2_measure.py`: 5 ms RMS, speech present while above -40 dB of the file's maximum, gaps under 120 ms merged) sees speech start and stop. In revision 1 the worst difference was +130 ms at the end of `s6` (the word "budget."), measured on a loudness-normalised voice-only mix (stated tolerance 80 ms).

Evidence (`out/phase3/boundary/`, tool `scripts/phase3_boundary.py`):

* **Spectrogram and waveform** (`rev1-loudnorm-voice-only/s6-end-spectrogram.png`, `rev2-unprocessed-placement/s6-end-spectrogram.png`; blue = start of "budget.", green = aligner end): the last visible speech event, the release of the final /t/, ends at the aligner's end (16.32 s). After it there is only a decaying broadband floor; in the loudness-normalised revision-1 file its RMS is -50.8 dBFS between 16.35 and 16.45 s against -15.8 dBFS for the speech (35 dB lower), and -60.7 dBFS by 16.5 to 16.7 s.
* **Threshold sweep:** the detector's boundary for that word depends on its threshold (error against the aligner: -15 ms at -30 dB, -5 ms at -35 dB, +130 ms at -40 dB, +190 ms at -45 dB, +220 ms at -50 dB, +285 ms at -60 dB). There is no stable "end" below about -35 dB; the aligner's end agrees with the end of the energy that is clearly speech.
* **Sensitivity to processing:** the aligner's end sits at -41.0 dB of the file maximum in the loudness-normalised file and -42.0 dB in the unprocessed placement mix. One dB moves the -40 dB crossing across a flat part of the decay: +130 ms against 0 ms. Measured on the unprocessed placement mix (the draft mix of the same takes: same offsets, no accents, no processing) the same detector reads the `s6` end at 0 ms and the worst boundary of all eight segments at 70 ms (the end of `s8`), inside the 80 ms tolerance.
* **Placement:** takes are placed at sample-exact offsets by construction, and the unprocessed placement mix shows no boundary beyond 70 ms.

**Fix:** none to the audio or the timing. The placement check is now run on the unprocessed placement mix (revision 1 used a mastered voice-only mix, whose dynamics moved the tail). The measurement tool also records, for information only, the worst error at -30, -35, -40, -45 and -50 dB (revision 2 sample: 80, 75, 70, 300, 350 ms). The pass check and its 80 ms tolerance at -40 dB are unchanged.

**Remaining uncertainty:** an energy detector cannot resolve the end of a decaying final consonant better than roughly 100 to 300 ms on this audio, so a boundary check above -40 dB says the alignment is consistent with the audio, not that it is exact. The alignment's own accuracy rests on the Phase 2 comparison with hand-marked boundaries on one take (mean 21 ms, worst 50 ms). No one has listened to the boundaries.

## 4a. Captions

Emphasis is data (ranges over the words of a caption). The context-window captions were split into short phrases so the pill stays at 48 px or larger. The `*…*` markers in the prototype's own pill code are untouched; the library pill is a data-driven equivalent (same dark pill, same orange, same timing rules: in 0.14 s, out 0.2 s, the last caption lingers).

## 5. Layouts, fit check and the dense fixture (measured)

The fit check (`src/library/fit.ts`) tests rectangles and declared text sizes, not appearance: safe area (left 60, right 1020, top 96, bottom 1824), caption band (y 1540 to 1660), **essential text at least 36 px and secondary labels at least 28 px** (raised in revision 2 from 28 and 22; 12 px and 9 px on a 360 px wide phone preview), estimated text width (including letter spacing) against its box, box height against its text, overlap with Pip's box (a movable-Pip layout allows overlap only for items marked as shown while he is away), overlap between items that are on screen at the same time (containers, and items with no beat in common, excluded).

* **Dense fixture** (`samples/dense-pip-fixture/`, 24 fictional cards, 4 columns): passes in `dense-pip` with the raised minimums (card labels are secondary at 28 px, values 56 px); the same content in `card-over-pip` (large fixed Pip, 620 px card) is flagged because the cards are about 119 px tall and their text needs about 140 px. Stills: `out/phase3/dense-fixture/`.
* **Context-window scene** (revision 2) passes `content-led` at the raised minimums; its outcome panels cover Pip's box only because the layout lets him leave, and the check says so if one is not marked that way. The check found two real overlaps in my first geometry (title against counter, banner against caption), which were corrected.
* **Legacy regression** (join-fanout preview, six frames): the new composition renders the same bytes as the original `EpisodeVideo` composition (slow test). A regression check only.

## 6. Fonts

The project had no redistributable font. Proposed and installed: **Inter** (variable, v4.66, from `rsms/inter`, commit `e3a3d4c`) and **JetBrains Mono** (variable, from `JetBrains/JetBrainsMono`, commit `1937130`), both **SIL Open Font License 1.1**, licence text beside each font and hashed in `public/library/fonts/manifest.json`. SF Pro is a system font and is not copied. Nothing of the prototype's typography was replaced: `pip-paper` keeps the system stack and is the comparison reference.

* Side-by-side of the prototype's hierarchy: `out/phase3/fonts/side-by-side.png` (system stack left, bundled right). Inter at the same weight and tracking is tighter and heavier; whether to adopt it, adjust tracking, or choose another face is yours to decide by eye.
* A font that is missing or altered fails the font check, and the render handler refuses a `pip-paper-bundled` render (tests remove, alter and unlicence a font). In the browser a font that fails to load fails the render; there is no silent fallback.
* The context-window sample uses `pip-paper-bundled` so that it is reproducible; this is not a font approval.

## 7. The sample: AI context window (simplified), revision 2

`samples/context-window/` (episode and settings). Revision 1 is kept in `out/phase3/context-window-rev1/` for comparison; revision 2 is `out/phase3/context-window-rev2/`: `context-window_final.mp4`, `mastered-mix.wav`, `voice-only-placement.wav`, `timeline.json`, `takes/` (the saved narration; the only copy now, see `docs/studio/README.md`, Generated output), `validation-report.json`, `measurements.json`, `review-frames/` (16 frames from the final MP4, `contact-sheet-360px.png`). Frames rendered before the production run, on the real timing of revision 1: only the contact sheet and timing remain in `out/phase3/context-window-rev2-frames-before-render/` (the full-size frames of the final MP4 are in `review-frames/`).

**Narration is unchanged.** Revision 2 imported the saved takes (SHA-256 of both WAVs identical to revision 1's; revision 1's copy was then removed as a duplicate); the script, voice, takes and the 24.26 s timeline are the same, and the aligner ran again (2.3 s, all eight segments `aligned`).

* **Script (eight sentences):** "A model can only read so much at once. That limit is its context window. Your text is cut into small pieces called tokens. Each token uses up some room. The reply uses room too. In many models, input and output share one budget. When it fills, what happens depends on the product. Some stop. Others drop older text."
* **Claims checked against primary documentation before writing** (links in the episode `sources`): the Anthropic API documentation says the context window includes the model's own response and describes different overflow behaviour (an error when the input alone is too long; on newer models generation stops with a dedicated stop reason; chat interfaces may roll older text off); the Google Gemini documentation says one model family shares the window across input, thinking and output while earlier models use separate input and output limits. Hence "in many models" and "depends on the product", and the on-screen labels "Illustrative · 1 piece = 1 slot" and "Token pieces are illustrative, not from a real tokenizer".

**What changed for phone-scale readability.** The review was right that the grid dominated and the readouts were small.

* **One focal point at a time.** Every group (header, prompt, grid, budget bar) is dimmed to 40 percent unless it is the subject of the beat: the window and the "context window" label; the prompt cut into pieces; the count; the reply filling; "input" (the question and earlier chat highlight), "output" (the reply highlights), "share one budget" (the whole bar and the grid outline); "fills" (the full counter and grid); then the outcomes; at the end everything returns to full. The highlights are timed to the spoken words (new cues `input_word`, `output_word`).
* **Smaller, quieter grid; larger information.** Slots are 52 px with no text inside (the pieces' text lives only in the large chips); the grid is 712 px wide instead of 852. Text sizes (px on the 1080 canvas): counter 46 to 72; header label 30 to 44; prompt pieces 28 to 40; budget label 30 to 44; legend 30 to 38; outcome titles 42 to 72 and subtitles 28 to 44; the disclosure note 28 to 36. Removed as secondary clutter: the card header text, the "1 piece of text = 1 slot" line (merged into the top label), the separate budget panel beside Pip, and the slot text.
* **Outcomes.** The two outcome panels are now full-width (960 × 600 each) and use the space Pip leaves; the window card fades out while they are shown.
* **Staged bar and legend.** The budget bar and a four-item legend (question, earlier chat, reply, free; each with its count) are present from the start, dim, and become the focus at "input", "output" and "share".
* **Pip, the voice and the approved prototype are unchanged.** Pip still looks, points twice (the label, then the budget bar, now timed to "input"), reacts when the window is full, steps out of frame for the outcomes and walks back, with the idle and the audio-driven mouth. No cards or decorative effects were added.

**The 8 -> 24 count, made explicit.** When the eight pieces have landed the counter reads 8 / 60. At "Each token uses up some room" a banner appears above the grid: **"8 + 10 = 18"**, counting up to **"8 + 16 = 24"** as the earlier-chat slots fill, captioned "your question + earlier chat". The question's eight slots are solid orange; the sixteen earlier-chat slots are a lighter orange; the bar and the legend carry the same colours and counts (question 8, earlier chat 16). The 16 are an illustrative stand-in for earlier messages in the conversation, which real systems also place in the window; they are not from a real tokenizer.

**Frames (what I saw; not approval).** In the 360 px contact sheet each beat has one clear subject; the count banner and its caption are readable; the budget bar is the largest object at "share one budget"; the legend and the caption pill are the smallest text and are readable but small. Two problems found in the first pass were fixed before the render: legend labels touching their numbers, and the empty lower half of the card in the first beats (the bar and legend now show from the start).

**Measured (revision 2).** Final mix and decoded MP4 as in section 3. Timeline 24.26 s; MP4 24.277 s, 728 frames, 1080 × 1920, 30 fps. Segment boundaries against the unprocessed placement mix: worst 70 ms (s8 end), s6 end 0 ms; sweep 80, 75, 70, 300, 350 ms at -30 ... -50 dB. Stage times: aligner 2.3 s, placement mix 0.6 s, final mix 1.1 s, render 27.5 s; peak sampled worker RSS 1.67 GB; no narration was generated in this revision. (Revision 1 resources: narration RSS 1.86 GB and MLX peak 8.3 GB per block; memory pressure over 55 samples: 52 normal, 2 warning, 1 critical, not sustained; swap already 7.5 GB before the run.)

## 8. Limits and known gaps

* **The limiter's sound is unjudged.** The loudness target is met by peak limiting of up to 6 dB on some peaks. Only a listener can say whether that is acceptable, and whether a compressor variant would be better.
* **Boundary checks above -40 dB are consistency checks, not ground truth** (section 4).
* **The decoded MP4 reads 3 dB lower true peak per channel** because the render duplicates the mono mix into two channels at -3 dB each; the WAV is the binding measurement. A player that sums the channels will play the file louder than a mono source would be at the same level; I did not measure playback devices.
* **Text sizes are at, not far above, the new minimums:** the smallest essential text is the disclosure note (36 px) and the legend (38 px); the slots carry no text. Whether this reads well on your phone is your call.
* **The 16 "earlier chat" slots are illustrative**; the scene derives them as input minus the prompt's pieces. There is no tokenizer, and the pieces must spell the prompt.
* **Cue rules for new scenes are hand-written data**; there is no editor. A missing cue fails the render with the cue's name.
* **Pointing** is limited to about 38 degrees from vertical by the prototype's rig.
* **Mixed episodes** (legacy and Pip scenes together) are not checked against the v1 rules.
* **Render sources** are read from the working checkout and verified against what was recorded; they are not copied.
* `pip-scene-10x` as pipeline output needs the one-block, seven-segment layout its cue rules name.
* The prototype's own `*...*` caption markers and fixed text sizes are not subject to the fit check (the prototype is frozen).

## 9. What needs your eyes and ears

* **Listen** to `out/phase3/context-window-rev2/context-window_final.mp4` (and, for comparison, `out/phase3/context-window-rev1/context-window_final.mp4`, the first mastering): the Pip voice, whether every word was spoken, pacing, the accents, the loudness, and whether the peak limiting is audible.
* **Watch** it with sound at phone size: whether the single focal point at each beat works, whether the 8 + 16 = 24 moment is clear, whether Pip's reactions and his leaving and returning read well, and the text sizes. The 360 px sheet is `out/phase3/context-window-rev2/review-frames/contact-sheet-360px.png`.
* **Decide** the font (Inter and JetBrains Mono, kept for this revision, versus the system stack), and whether the `content-led` layout is the right second template.
* The sign-offs `listened`, `watchedPhoneSize` and `customScenesReviewed` are yours; none was recorded.

## 10. Tests (this session)

* `npm run test:ts`: 362 tests, 58 suites, 362 pass, 0 fail, 0 cancelled, 0 skipped. `npm run test:py`: 30 tests OK. `npx tsc --noEmit`: no errors. `npm run test:slow` (prototype manifest and video checks plus the two render comparisons): 6 tests, 3 suites, 6 pass, 0 fail, 0 skipped.
* New in revision 2: complete-mix mastering (target, ceiling, no compression, accent level, alignment); fit minimums of 36 and 28 px and the beat-aware overlap rule; the context-window cue order including `input_word` and `output_word`.
* Earlier: score equals `perform()` on 489 frames; cue rules equal the prototype's cues; accents match the prototype's sound track and every validation rule; mouth equals the prototype's; emphasis ranges and timeline annotation; fonts present, altered, unlicenced; the dense fixture in two layouts; accents through the real mix in the job pipeline; legacy and prototype render equality.
* Spot checks (copy, break, run, restore): a cue offset, a score value, the font hash check, the emphasis text check, the safe-area rule, the accent gain range, the accent scaling in the final mix, and the limiter each made a test fail.
* Protected paths (`reference/`, `prototypes/`, `episodes/`, `src/art/`) show no changes; no `.studio` folder exists in the repository.
