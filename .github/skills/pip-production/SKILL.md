---
name: pip-production
description: Produce or review Pip-narrated explainer scenes in the Explainer Studio app (explainer-studio/). Use when creating topic-specific animations, scenes or components, changing Pip's look or animation, the approved Pip voice, narration timing and cues, phone-size layout, or when reviewing a rendered MP4. Separates what the pipeline implements and measures from what is planned and from what only a person can judge.
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

Creative references, three jobs (`explainer-studio/docs/studio/15-creative-benchmark-and-review-records.md`): `prototypes/pip-scene-10x-v1/` is the reference for **Pip's character and expressive performance**; `out/phase4/slice2/context-window_slice2_rebuilt.mp4` (sha256 `cd6fa2aaf645b7df120c40edc9c5feebdb1c9c4e107acff53038202dd2d7fd08`) is the author's **primary visual benchmark for explanatory storytelling**; the Phase 8 final output demonstrates the complete production workflow and is not a creative benchmark. The table-lab output of Phase 2 is a technical pipeline test only (its style was rejected); never use it as a visual reference. Follow the current phase in `docs/studio/05-implementation-plan.md`. No 3D, no new dependencies, no UI work outside the phase. The generic composition, the scene library (`src/library/`), layouts and the performance score are Phase 3 (done, awaiting review); the app UI is Phase 4.

## Visual identity

* Layered figure rebuilt from an approved target image. Expressions in the schema (`src/schema.ts`): `neutral`, `thinking`, `surprised`, `happy`, `concerned`, `pointing`.
* Warm-paper art direction in `src/art/palette.ts`: cream ground, ink text, colour carries meaning (amber = the join key, rose = a copied amount). Do not use those colours as decoration.
* Known gaps are listed in `src/art/pip-layers/notes.tsx` (hands, flatter material, body angle fixed across small views). Do not claim them fixed and do not hide them with 3D.
* Legacy episodes use the dark theme in `src/theme.ts` (`style: legacy-dark`). Pip episodes use warm paper: `pip-paper` (the prototype's system font stack, the comparison reference) or `pip-paper-bundled` (Inter and JetBrains Mono, OFL, in `public/library/fonts/`; the font choice is the author's to confirm).
* Any change to Pip's look is a design change: show before and after frames to the author.

## Visual storytelling (the author's preferred benchmark)

The author watched `out/phase4/slice2/context-window_slice2_rebuilt.mp4` and found it "much clearer and more visual than the Phase 8 final output". That is the only reason on record. It is a quality reference, **not a template every topic must copy**, and it is not an approval of anything (`docs/studio/15-creative-benchmark-and-review-records.md` has the comparison, the observations kept apart from the hypotheses, and what the author did and did not review).

* Explain a concept by **changing objects, states and relationships** on screen (a window of slots that fills, a counter and bar that follow it, a full state and its two outcomes), not by a card that restates the narration.
* **Keep the object on screen** while the idea continues and let it change; avoid rebuilding the screen at every segment.
* Use **cards selectively**: a name, a definition worth reading, a comparison that needs exact words. Narrated text cards with mascot gestures are not the default (`pip-cards` is a generic scene, not a visual benchmark).
* Show quantities, what each colour means and the consequence; label simplifications on screen.
* Pip keeps his approved identity, voice and visual direction. He points at or reacts to what *changes*.
* Reading burden: the sentences are in the narration and the caption; the picture carries labels and numbers.
* Not tested: whether a generic scene can reach this clarity, and whether a non-quantitative topic needs a different treatment. Do not claim either.

## Presentation flexibility (approved 24 October 2026)

`docs/studio/pip-brand-standards.md` > **Presentation flexibility** is authoritative. Keep Pip, the approved voice and art, typography, the orange identity, series numbering, consistent covers and a clear takeaway. The chapter header and full stage strip are the default navigation but need not occupy every body shot (use `ChapterTag` for a compact label or clear the chrome during a close-up, and restore the map at meaningful transitions). Close-ups and demonstrations may use the frame between the compact header and the caption band. Pip may move, take part or leave a shot (`move` tracks in his score). A scene camera moves the scene only: captions and the brand header stay in screen coordinates. Existing episodes keep their defaults: new presentation controls are opt-in, never retrofitted to frozen or published cuts. Vary shot scale and representation to explain, not to decorate. Recipes for the camera, focus/read/return plan, masks, chapter tag and Pip movement are in `explainer-studio/docs/studio/16-pip-opening-workflow.md` §2f.

## Creating new scenes and components

The author authorizes creating animations and components from scratch whenever an approved video brief needs them. Treat the scene library as a toolkit that grows with the topics. Routine scene creation within that brief can proceed without a separate approval request; human review of the resulting video still applies.

1. Identify the mechanism the viewer should understand and the visible change that demonstrates it. Sketch the objects, relationships and narration beats before implementation.
2. Reuse existing pieces where they fit. When they cannot show the mechanism clearly, build a topic-specific scene, component, diagram or transition using the existing stack. A missing scene is a reason to extend the library, not to replace the explanation with narrated text cards.
3. Put new scene code alongside the library's existing scenes, import the approved Pip artwork and performance tools unchanged, and register new scene types through the normal validation, cue, timeline and render paths. Keep new content separate from frozen prototypes, approved voice references and benchmark outputs. Do not bypass unsupported-input checks or silently substitute a generic scene.
4. Keep a consistent channel identity through Pip, typography, palette and purposeful motion while allowing each topic its own visual treatment. Build only the abstractions the current explanation needs; promote components for reuse when there is a concrete use for them.
5. Verify relevant scene validation and timeline behavior, inspect frames at important state changes at phone size, then review the actual rendered MP4. Report production checks separately from the author's listening, viewing and approval.

For example, a caching episode can add a persistent request/cache/database animation showing a cache miss, storage, a hit taking the shortcut, and an explicit refresh after a price change. Label illustrative timings and explain the chosen refresh policy; the animation should demonstrate the mechanism rather than imply every cache behaves identically.

Creative freedom does not change the existing rules on dependencies, paid services, model downloads, sequential heavy work or protected assets. 3D remains deferred. Changes to Pip's identity or the approved voice still require the author's design decision.

## Standard branded opening

Follow `docs/studio/pip-brand-standards.md` for the channel identity and matching cover-image requirements. Export a clean opening-frame PNG alongside each new video; the author chooses it as the cover at upload.

For every new Pip episode, set `openingHook` on its first scene to a short curiosity hook (at most 48 characters), backed by what the video actually teaches. Keep the descriptive topic in the episode title. The shared `src/library/PipOpening.tsx` renders the Pip Explains banner, hook and original Pip entrance, then normally settles into a compact header over 1.7–2.25 seconds. A spoken series introduction keeps the full opening visible through the series line and hook, with the transition aligned to the explanation as specified in the brand standard. It runs alongside the opening narration on the same clock; it adds no silent bumper or timing offset.

For the quiet opening sound signature, record a synthesized `chime` at `t: 0.12`, `gainDb: -21` in the episode sound settings, mixed under the narration through the existing accent bus.

Reserve the header strip at y=96–180 for the shared banner and compact hook. Keep captions in their normal band. Reuse this component through `LibraryEpisode` rather than inventing a new channel bumper in each scene. Preserve older episodes without `openingHook` and frozen reference outputs. The caching episode's approved hook is “Faster apps do less work”. A changed hook is visual content: rebuild the video while reusing unchanged narration and mix; never label an earlier video current after that edit. When replacing the first scene, carry its intended hook into the replacement.

In the app (`explainer-studio/docs/studio/16-pip-opening-workflow.md`): enter the hook in the *Opening hook* card (Script and Scenes steps) rather than editing JSON; a new episode gets the quiet opening chime once and cannot be built without its hook; the Review step's *Cover image* card draws the cover from the rendered video (frame 20, no captions), tracks which video it belongs to, marks it outdated after any edit that stales the video, and the approved export includes it. Never edit `src/**` to change this: projects record their render sources and refuse to render or draw covers when they differ. For the approved chapter header, stage strip and full-page takeaway, reuse `src/library/chapters.tsx` and keep topic labels and stage logic in the scene (`CacheJourney.tsx` is the example).

## Series label and publication preview

Before numbering, rendering a series episode or preparing a post, read **Series identity and numbering** and **Preview before publishing** in `docs/studio/pip-brand-standards.md`. They apply to all series, including news: verify the series episode number, render it on the cover/opening and compact header, and use a total only for a defined run. Speak the series name and episode number before the hook (include a total only for a verified finite run); hold the full opening through those lines and align its transition to the explanation. Follow the authoritative standard’s spoken-opening rule. Show the exact final video, cover and caption before publishing and wait for that version’s approval unless the author explicitly waives review. Documentation alone does not implement the metadata in Studio; inspect the actual output.

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

Review feedback is recorded **per build** (file and hash) in `explainer-studio/docs/studio/15-creative-benchmark-and-review-records.md`. "The author watched it and liked it" is positive visual feedback on that build only: it is not export approval, not a check of every spoken word, not factual approval, and does not carry to a newer build.
