# 13 · Phase 7: Review, final render, approval, export

Status: **implemented; the automated checks pass; your review is pending.** No listening, viewing or approval is recorded anywhere for the
demonstration video. No sign-off box was ticked, no playback was recorded, no round was opened and nothing was approved or exported on the demo
workspace. Those are yours to do.

Scope kept: nothing from Phase 8 (packaging, hardening), publishing, 3D or external tools was started. Real-project `init`/`adopt` stays paused.
Protected paths (`reference/pip-voice/approved-v1/`, `prototypes/pip-scene-10x-v1/`, `episodes/*`, `src/art`) are unchanged
(`git status --porcelain` on them is empty).

## What is built, against the Phase 7 acceptance criteria

Open a draft, then **Review** (step 7). The page is `/?review=<episode id>`.

| Acceptance item | Where | How it is shown to you |
|---|---|---|
| Notes and rounds | Review screen; notes live in the episode document, rounds in the project database | A round is tied to one video (its file hash). A note keeps the segment text, the spoken words and the scene it was written against for good; "It still applies" adds a fresh baseline instead of rewriting that context. Reassessment says what changed since. |
| Draft and final renders | **Make a draft video…**, **Make the final video…** (the rebuild plan dialog, with `mode`) | The plan lists what runs and what is reused. A draft uses the unmastered mix and is labelled "Draft (not mastered)" everywhere; it can never be approved or exported. The final uses the mastered mix. A failed or cancelled build keeps the earlier builds. |
| Narration checks | `core/checks.ts` | A segment with no take, a missing take file, a truncated take (ends abruptly) and a long silent gap are each reported (fixtures that fail and fixtures that pass). A dropped word is **not** reported; the screen says so and the listening item covers it. |
| Captions against spoken text | `core/checks.ts`, `core/numberWords.ts` | A missing override for a symbol, a number spoken differently from its caption, and an unlisted word difference are each reported. A difference you confirm on the screen passes, and the confirmation is bound to that exact text. |
| Fonts and layout | `workers/probe-worker.ts`, `src/library/probe.tsx`, `core/probeFrames.ts` | The video's own scenes are loaded in the same browser engine that renders them at sampled frames. Unloaded fonts, overflowing text, overlapping essential boxes, essential elements under the mascot or in the unsafe area, and text below its minimum size are reported. A scene with no marked elements is reported as only partly checked. |
| Mastering | `core/checks.ts` (ffmpeg on the file) | The loudness measured inside the MP4 is compared with the target; a draft reports "not mastered"; a file altered after rendering fails the hash check. |
| Custom scenes | `core/checks.ts` | Reported as "generic checks only". |
| Final-file review | Review screen player | Playback is recorded as ranges actually played; approval needs the ranges to cover the whole file. The screen says these are recorded actions, not verification. |
| Approval | `app/review.ts`, `POST /api/episodes/:id/review/approve` | Records the file hash and the input hash. Needs: a round on the current fresh mastered final, an up-to-date passing check report for that exact file, four sign-offs ticked by a person, complete playback coverage, and no open notes. The route needs `{roundId, confirm: true}` and ignores any sign-offs sent in the request. Changing any hashed input voids it. |
| Export | `core/export.ts` | Copies the approved file's exact bytes, hashes before and after, and refuses if the file is missing or altered. Writes captions, metadata, credits and checksums, and no private prompts, local paths or logs (the writer refuses text that contains them). It spawns no process (see the tests below). |

Check results carry one of four labels: **Measured** (computed from the file or the data), **Heuristic warning** (a rule of thumb), **Only partly
checked**, and **You judge** (only a person can).

## Measured results

Automated checks, run in this session:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) |
| `npm run test:ts` (fast suite) | 698 tests in 141 suites: 698 pass, 0 fail, 0 cancelled, 0 skipped |
| `npm run test:slow` (real browser, renderer, ffmpeg; now includes the two Phase 7 slow files) | 54 tests in 9 suites: 54 pass, 0 fail, 0 cancelled, 0 skipped (the third full run; see "Test runs that failed on the way") |
| Phase 7 files on their own | `checks.test.ts` 34/34, `review.test.ts` 21/21, `export.test.ts` 13/13, `review-jobs.test.ts` 10/10, `review-api.test.ts` 9/9, `logic.test.ts` 11/11, `review.slow.test.ts` 3/3 (a real browser, simulated clicks), `probe.slow.test.ts` 4/4 (real browser probe) |

What the tests do and do not show:

* The approval and export mechanics were tested only in **isolated temporary projects** with explicitly **simulated** sign-offs and playback.
  They show that the rules are enforced (a forged sign-off in a request is ignored, a draft cannot be approved, a changed input voids approval,
  an altered file is refused on export). They do not show that anyone listened.
* "Export spawns no process" is checked two ways: a test that traps every process spawn during an export, and a static check of the export
  module's imports. It is not a system-wide process monitor.
* The fake-worker end to end tests (`review-jobs.test.ts`) check the draft and final chain, failure and cancel keeping earlier builds, and the
  check job running real ffmpeg on a small file.

### A real defect found and fixed

While testing, a spoken-text edit kept the old caption line breaks (`captions`), so the video would have drawn the **old words** instead of the
new ones. `setSegmentText` (`app/shared/edit.ts`) now resets a segment's caption line breaks when its words change, and says so in a note. One
consequence: typing the old words back no longer restores the old line breaks; an undo (which restores the whole segment) does. Two tests in
`tests/app/jobs.test.ts` had assumed that retyping restored everything; they now restore the segment exactly, as an undo does, and expect the
timing, mix and video of that earlier state to be reused.

### Test runs that failed on the way, and what was done

* `npm run test:ts`: the first run had 2 failing tests (4 reported lines with their parents). They were the two tests that typed an old segment
  text back and expected everything built from it to be reused; the caption-reset fix above made that retyping differ. They now restore the
  segment exactly, as an undo does. Rerun: 698 of 698 pass.
* `npm run test:slow`, run 1: 3 failures. (1) The planner browser test counted 5 stepper links; Review is now a link, so 6 (test updated).
  (2) Two probe tests failed only inside the full suite: the probe waited for `document.fonts.ready`, which can resolve before a face has begun
  to load when the machine is busy, so text could be measured in a fallback font. That is a real robustness fault in the check (a busy machine
  could give a wrong layout result). The probe now loads every declared face, and records a failed one as `error`, before measuring.
  (3) Run 2 added `rebuild.slow.test.ts` "editing while a step runs": the test compared the preview's build label with a read taken before the
  page had refreshed after a finished step. That is a race in the test, not in the app (the server already showed the newer build); the test
  now waits until the page shows the build the server shows. That file then passed 9 of 10 further runs; **one failure was not captured and is
  not explained**. The final full run passed 54 of 54.

### Phase 6 report corrections

Done in [12 Phase 6: Voice](12-phase6-voice.md): the estimate error formula is stated exactly, range coverage is reported separately from point
error (2 of 7 inside the estimated range; 6 of 7 within 30% of the point estimate), and the worker's RSS (451 MB) is labelled as RSS, not as the
model's memory (MLX peak 8.1 to 9.7 GB).

## The real demonstration (the separate draft "Voice demo: prompts")

Run by `scripts/phase7_demo_ui.ts` through the real page in a headless browser, with the real aligner, the real Remotion renderer, the real
mastering and the real browser probe. Recorded in `docs/studio/phase7-evidence/demo-run.json`, with screenshots beside it. The script was run
three times on the same draft: (a) the first run built both videos and checked them; (b) after a source file of the render changed (the probe
fix above) both videos were out of date, so it rebuilt them from the final sources, but that run read the wrong video's report for the
draft (it read the default video, the final, instead of the one it had selected); (c) the script was corrected to read each video's own
report by id and run again on the same videos. The evidence file is from (c) and carries the build figures of (b); the job list is jobs 27 to
38 of the draft. The render produced the same bytes in (a) and (b) (same SHA-256 for each video).

1. The draft only had a stand-in scene, so a storyboard was applied through the planner's own routes (import, accept, apply). Result: three
   `pip-cards` scenes for s1 to s7. Its narration was unchanged by this and both takes stayed fresh.
2. **Make a draft video** (run a): the plan showed both takes as current, timing and the draft video as "run" and the draft mix as
   already up to date. Timing 3.2 s; draft video 25.6 s (25.6 s again in run b). **Narration jobs run: 0** (the Phase 6 takes were
   reused) across all 12 jobs.
3. **Production checks on the draft** (video #33, 10.7 s): 20 pass, 2 warnings, 0 fail, 2 not examined, 2 info; 30 frames measured in the
   browser. Loudness: not mastered (measured -23 LUFS, -7.5 dBTP), reported as information, as designed.
4. **Make the final video**: timing reused, mastered mix 1.2 s, final video 25.0 s (25.1 s in run b).
5. **Production checks on the final file** (video #35, 10.7 s): 22 pass, 2 warnings, 0 fail, 2 not examined, 1 info. File checks: hash
   matches, h264 1080 x 1920 at 30 fps with an AAC track, the whole file decodes. Measured loudness -16.1 LUFS (target -16) and -4.7 dBTP true
   peak (limit -1.5). Layout: no overflow and no overlap in the 30 sampled frames; all 3 scenes had marked elements that were measured.

The two warnings, as reported (on both the draft and the final):

* **Heuristic:** block b1 ends within 20 ms of its last sound (no trailing silence). Something to listen for at the join to block b2.
* **Heuristic:** the first font choice `SF Pro Display` is not available to the browser; `system-ui` is used.

Not examined by the app, by design: that every word is actually spoken, and whether the join between blocks is audible.

Files for you to open (git-ignored, regenerable): `out/phase7/demo/voice-demo-prompts-draft.mp4` (SHA-256 `274b84ae837b…`, 22.73 s) and
`out/phase7/demo/voice-demo-prompts-final.mp4` (SHA-256 `c3ba796a551b…`, 22.73 s). The final is the file the checks ran on.

Left for you, on `/?review=voice-demo-prompts`: open a review round on the final, watch it all the way through, listen, write notes, tick the
boxes if you agree, then approve and export. Nothing has been approved: `approval` is `none`, 0 of 4 sign-offs are ticked, no round exists
and nothing was exported. The approved baseline episode (`context-window`, seq 15, hash `59396c69a98c…`) and the other draft were only read,
and are unchanged. Console errors and failed requests during the run: none.

## Limits, stated plainly

* Playing a video and ticking a box record that you did it. They are not evidence that you paid attention or that the content is right.
* A word the voice dropped cannot be found by these checks. Alignment gives times to the text it is given. Only listening finds it.
* Custom scenes (code written for one episode) get the generic and file checks only.
* The layout probe measures only elements the scene marks. Today that is the Pip cards scene and the caption; other library scenes are "only
  partly checked".
* The layout probe reads the sources in the working checkout. Its frames match the render only if the working copy still matches the sources
  recorded for that render; if not, the fonts, overflow and overlap checks are reported as not examined (with the differences) instead of drawing frames that would not be this video's.
* Draft videos are full renders only; there is no ranged or partial draft.
* Export does not make thumbnails, because that would spawn a process.
* The heuristic thresholds (pace, edge silence, abrupt end) were calibrated on a few takes; they may be wrong in either direction.
* The demonstration used one episode of about 23 s. Timings are what that run took, not a promise.
* The approval and export mechanics have not been used on a real project, by design (isolated test projects only).

## For you to judge

Listening to the narration (words, seams, the block join the warning points at), watching the video at phone size, whether the cards and Pip
read well, and whether to approve the final. The checks cannot do any of this.
