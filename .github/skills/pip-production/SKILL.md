---
name: pip-production
description: Produce or review Pip-narrated explainer scenes in the Explainer Studio app (explainer-studio/). Use when changing Pip's look or animation, the approved Pip voice, narration timing and cues, phone-size layout, or when reviewing a rendered MP4. Separates what the pipeline implements and measures from what is planned and from what only a person can judge.
---

# Pip production

Facts come from this repository's documents and code; new guidance is marked *(proposed)* and is not approved until the author says so. If this skill and the repository disagree, the repository wins.

## Where things are

The Git root is the parent of the app. **The app is `explainer-studio/`**; every path below is relative to it, and commands run from there:

```sh
cd explainer-studio    # from the Git root, before any npm, node, python or ./studio command
```

* Plan and status: `docs/studio/05-implementation-plan.md`, `docs/studio/06-phase2-acceptance.md`.
* Pip art: `src/art/pip-layers/` (figure, hands, views), `src/art/pip-scene/rig.ts` (keyframe tracks), `src/art/palette.ts`.
* Pipeline: `core/` (project store, runner, handlers), `workers/` (audio, mix, render), `pipeline/timeline.py` (timeline logic).
* **Protected, never edit:** `prototypes/pip-scene-10x-v1/` (frozen, with checksums) and `reference/pip-voice/approved-v1/` (read-only approved voice). Read, copy from, compare against.

## Scope

The creative baseline is `prototypes/pip-scene-10x-v1/`. The table-lab output of Phase 2 is a technical pipeline test only (its style was rejected); never use it as a visual reference. Follow the current phase in `docs/studio/05-implementation-plan.md`. No 3D, no new dependencies, no UI work outside the phase. The generic composition, the scene library (`src/library/`), layouts and the performance score are Phase 3 (done, awaiting review); the app UI is Phase 4.

## Visual identity

* Layered figure rebuilt from an approved target image. Expressions in the schema (`src/schema.ts`): `neutral`, `thinking`, `surprised`, `happy`, `concerned`, `pointing`.
* Warm-paper art direction in `src/art/palette.ts`: cream ground, ink text, colour carries meaning (amber = the join key, rose = a copied amount). Do not use those colours as decoration.
* Known gaps are listed in `src/art/pip-layers/notes.tsx` (hands, flatter material, body angle fixed across small views). Do not claim them fixed and do not hide them with 3D.
* Legacy episodes use the dark theme in `src/theme.ts` (`style: legacy-dark`). Pip episodes use warm paper: `pip-paper` (the prototype's system font stack, the comparison reference) or `pip-paper-bundled` (Inter and JetBrains Mono, OFL, in `public/library/fonts/`; the font choice is the author's to confirm).
* Any change to Pip's look is a design change: show before and after frames to the author.

## Approved voice

* "Pip voice v1": Qwen3-TTS Base 1.7B with the approved reference WAV and its recorded transcript as reference text, no style instruction. Facts and checksum: `reference/pip-voice/approved-v1/approved.json`.
* The reference came from the author's audition choice (B-US). "General American" is what was requested, not a verified property of the audio.
* **Approving the reference is not approving any generated take.** Each take needs listening.
* Generation is stochastic across versions; saved takes are the authority. A Qwen episode is never converted to Kokoro in production. A different voice is the author's decision, then re-approval.
* The pipeline records the reference hash and exact transcript with the voice settings and refuses to generate if they differ.

## Purposeful animation

* Every movement answers a narration beat: point, react, hold attention or reveal. Beats are anchored to words and use the expression and cue vocabulary above.
* Use deliberate holds and restrained idle motion. Blinks, small settling movements and subtle hovering are allowed when they support character presence. Avoid constant bobbing, repetitive gestures and effects that compete with the explanation.
* The mouth follows audio loudness, not visemes (a known limit). Do not call it lip-sync.

## Narration-to-action timing

* Cues fire 0.08 s before the word, a scene starts 0.25 s before its first word, captions are at most 5 words (`pipeline/timeline.py`). Change these only there, with its golden tests.
* Word times come from the forced aligner (`aligned`, 80 ms grid) or the envelope estimate (`estimated`); the label is in `timeline.json`. A `manual` label exists in the schema but **nothing produces it yet**.
* On the one take checked by hand, aligner error was 21 ms mean and 50 ms worst (`docs/studio/06-phase2-acceptance.md`). `aligned` means "produced by the aligner", not "verified".
* The 0.3 s caption-duration threshold stays (`docs/studio/README.md`, Decisions, item 2).

## Implemented now and planned later

| Implemented (Phases 2 and 3) | Not implemented: the pipeline refuses it rather than ignoring it |
|---|---|
| Narration blocks with the approved voice; block-level cache | **Manual timing corrections** (planned with the timing editor); a non-empty setting is rejected |
| Forced alignment with a labelled estimate fallback | **Pauses inside a block** (`pauseAfter` on a segment that is not last in its block): rejected; start a new block instead |
| Pause on the last segment of a block, added to the gap after it | **Sound assets**: rejected. Sound events other than the seven synthesized accents, or with unknown parameters, are rejected |
| Mix placement, `voiceGainDb`, loudness mastering for a final mix | **Other mix parameters** (only `voiceGainDb`, `accentBusDb`, `accentDuck`): rejected |
| **Sound accents** (pop, ding, chime, thump, tick, whoosh, swish; `soundEvents` with `cue` + `dt` or `t`, `gainDb`, `params`) mixed with the voice (ducked under it) and the complete mix mastered with a peak limiter to -16 LUFS / -1.5 dBTP; in the job snapshot and in the mix's dependency hash (with the timing) | Render settings other than 1080 × 1920, 30 fps, h264 + aac: rejected |
| **Scene library** `src/library/`: registry, `LibraryEpisode`, cue rules as data (`sceneSpecs.ts`), Pip performance score (`pip/score.ts`) with the prototype's own score reproduced, mouth track from the audio, caption pill with emphasis ranges (`emphasis` on a segment: `from`, `to`, `text`; plain text, validated), layouts `card-over-pip`, `content-led`, `dense-pip`, fit check (`fit.ts`), scenes `pip-scene-10x` (the frozen prototype, unchanged), `context-window`, `pip-dense-fixture` | Full isolation of render sources: they are read from the working checkout and verified, not copied |
| Fonts from tracked files with licences and a check (`checkFonts`); render refuses a damaged font folder | Editor UI, review sessions and sign-off recording (later phases) |
| Draft and final render, progress, cancel, isolated output; inputs frozen when a job is queued | |

## Phone-scale readability

* Canvas 1080 × 1920 at 30 fps. Safe area `left 60`, `right 1020`, `top 96`; caption zone from `y 1520`, width 900, 58 px (`src/theme.ts`, `src/components/Captions.tsx`).
* The fit check (`src/library/fit.ts`) holds essential text to 28 px and secondary labels to 22 px on the 1080 px canvas (about 9 px and 7 px on a 360 px wide phone preview), inside the safe area, clear of the caption band (`y 1540` to `1660` for the Pip pill) and clear of Pip's box. It checks rectangles and declared sizes, not how the scene looks.
* Judge at phone size: view frames at about 360 px wide, and watch the video on a phone-sized window.

## Reviewing the rendered output

Review the actual MP4, never only the Studio or Player preview.

**Measured by tools now** (`cd explainer-studio`; example: `.venv-qwen/bin/python scripts/phase2_measure.py <mp4> <wav> <timeline.json> <out.json> -16 -1.5`):

* Container, codec, dimensions, frame rate, duration, audio track (`ffprobe`).
* Integrated loudness and true peak of the mastered WAV and of the audio decoded from the MP4, against the targets, with stated tolerances (AAC and the render's mono-to-stereo duplication, which lowers each channel by 3 dB, change true peak per channel; the WAV is the binding true-peak measurement).
* Speech placement against `timeline.json` segment starts and ends, and the lag between the MP4 audio and the mastered WAV. These are energy-threshold checks: consistency, not ground truth.
* Caption and number checks and the legacy rendered-video checks of `./studio verify` apply to Kokoro-era episodes; they do not yet cover Qwen job output.

**Not measured: a person must do it**

* **Listen** to the whole file: every word was actually spoken (alignment cannot prove a dropped word), the voice sounds natural, pauses and pacing.
* **Watch** with sound on: cues and expressions land on the right word, motion looks purposeful and not distracting.
* **Watch at phone size**: text readable, nothing cut off or hidden.
* **Look** at the frames of every custom (Tier 3) scene.

Frames for review: `ffmpeg -i out.mp4 -vf "select='eq(n,45)+eq(n,200)',scale=360:-1,tile=2x1" -frames:v 1 sheet.png`, at each beat and scene change. State what was looked at and what was not. Do not write "verified", "sounds natural" or "approved" for anything only a tool saw. The author's sign-offs (`listened`, `watchedPhoneSize`, `customScenesReviewed`) cannot be given by this agent, and neither can approval.
