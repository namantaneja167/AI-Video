---
name: pip-production
description: Produce or review Pip-narrated explainer scenes in this project. Use when adding or changing Pip's look or animation, the approved Pip voice, narration timing and cues, phone-size layout, or when reviewing a rendered MP4. Separates automated checks from judgments that need a person to look or listen.
---

# Pip production

Facts here come from this repository's approved documents and code; anything new is marked *(proposed)* and is not approved until the author says so. If this skill and the repository disagree, the repository wins.

## Scope and guardrails

* Follow the current phase in `docs/studio/05-implementation-plan.md`. No 3D, no new dependencies, no UI work outside the phase.
* Never edit `prototypes/pip-scene-10x-v1/` (frozen, has checksums) or `reference/pip-voice/approved-v1/` (read-only). Read them, copy from them, compare against them.
* Pip art lives in `src/art/pip-layers/` (figure, hands, views) and `src/art/pip-scene/rig.ts` (keyframe tracks). Changes to it are design changes: show the author before and after frames.
* Tier 3 means custom code (`docs/studio/02-product-spec.md` §11). Recreating `pip-scene-10x` as data is Phase 3 work.

## Visual identity

* Layered figure rebuilt from an approved target image; expressions in the schema: `neutral`, `thinking`, `surprised`, `happy`, `concerned`, `pointing` (`src/schema.ts`).
* Warm-paper art direction in `src/art/palette.ts`: cream ground, ink text, colour carries meaning (amber is the join key, rose is a copied amount). Do not reuse those colours for decoration.
* Known gaps are written in `src/art/pip-layers/notes.tsx` (hands, flatter material, body angle fixed across small views). Do not claim they are fixed, and do not paper over them with 3D.
* The generic episode scenes use the dark theme in `src/theme.ts`. Which look Pip scenes share with them is a Phase 3 layout decision, not one to make in passing.

## Approved voice

* "Pip voice v1": Qwen3-TTS Base 1.7B (`mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16`) with the approved reference WAV and its recorded script as reference text, no style instruction. Details and checksum: `reference/pip-voice/approved-v1/approved.json`.
* The reference came from the author's audition choice (B-US). The "General American" label is what was requested, not a verified property of the audio.
* Generation is stochastic across versions; the saved takes are the authority. A production episode with a Qwen voice is never converted to Kokoro.
* A different voice or reference is a decision for the author, then re-approval.

## Purposeful animation

* Every movement answers a narration beat: point, react, hold attention or reveal. Beats are anchored to words and use the expression and cue vocabulary above.
* Between beats Pip rests. *(proposed)* No looping decoration; if a motion cannot be tied to a spoken word or a visual cue, remove it.
* The mouth follows audio loudness, not visemes (a known limit). Do not describe it as lip-sync.

## Narration-to-action timing

* Cues fire 0.08 s before the word, a scene starts 0.25 s before its first word, captions are at most 5 words (`pipeline/timeline.py`). Change those only through that file and its golden tests.
* Word times come from the aligner (`aligned`, 80 ms grid), the envelope estimate (`estimated`) or hand corrections (`manual`); the label travels in `timeline.json`. On the one take checked by hand, aligner error was 21 ms mean and 50 ms worst (`docs/studio/06-phase2-acceptance.md`). Treat `aligned` as "produced by the aligner", not "verified".
* The 0.3 s caption-duration threshold stays (decision 2 in `docs/studio/README.md`).

## Phone-scale readability

* Canvas 1080 × 1920 at 30 fps. Safe area `left 60`, `right 1020`, `top 96`; caption zone from `y 1520`, width 900, 58 px (`src/theme.ts`, `src/components/Captions.tsx`).
* The minimum text size per layout is set in Phase 3; the mockups use 36 px. Until then do not go below the sizes already used by existing scenes.
* Check at phone size, not on a desktop-size preview: view frames at about 360 px wide.

## Reviewing the rendered output

Review the actual MP4, never only the Studio or Player preview.

| Question | Automated (measured) | Needs a person |
|---|---|---|
| Right size, codec, duration, audio track | `ffprobe` on the file | |
| Audio matches the timeline | Decode the MP4 audio, compare speech onsets with `timeline.json` segment starts (Phase 2 got every one within 60 ms) | |
| Loudness and true peak of a final | Measure the decoded audio against the targets | |
| Captions spell the segment text; spoken numbers match | `verify` and the spec §7.2 checks | Intentional differences |
| Text fits, no overlap, minimum size | Spec §7.3 for DOM text, once built | SVG, canvas and image content (limited) |
| Every word was actually spoken | Cannot be proven by alignment | **Listen** to the whole file |
| Voice, pauses and pacing sound right | | **Listen** |
| Cues and expressions land on the right word; motion looks purposeful | Cue times against words | **Watch** with sound on |
| Readable on a phone | | **Watch** at phone size |
| Custom (Tier 3) scenes are correct | Generic checks only | **Look** at the frames |

Frames for review: `ffmpeg -i out.mp4 -vf "select='eq(n,45)+eq(n,180)',scale=360:-1,tile=2x1" -frames:v 1 sheet.png`, taken at each beat and at scene changes. Say what was looked at and what was not. Do not write "verified" or "sounds good" for anything only a tool saw: listening and phone-size viewing are the author's sign-offs (`listened`, `watchedPhoneSize`, `customScenesReviewed`), and this agent cannot give them.
