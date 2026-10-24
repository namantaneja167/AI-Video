# Phase 4, slice 2: actionable edits (rebuild, jobs tray, revision recovery)

Scope: make edits in the demo workspace actionable. A rebuild computes what is needed from the existing dependency hashes,
shows the plan first, runs it on the existing persistent job runner and previews the result. Nothing else was added: no
research or import screens, no advanced scene editing, no publishing, no 3D, no mascot or voice work, no new package or
service. `init`/`adopt` on the real studio is still paused. Stopped here for your review.

This document was corrected after the first hand-over (the unexplained worker kill, section 5; the invalid placement figure,
section 6; edits between steps, section 4; the screenshots, section 9) and again after the verification follow-up (section 8):
**status of slice 2: automated checks passing; user review pending.** The one unexplained browser-test failure (8.1) is
accepted as a documented limitation; its tracing and regression coverage stay, and it is investigated further only if it recurs
or new evidence appears. Section 8.4 adds the bounded real-model hand-over check, and section 12 the Phase 4 completion
checklist.

## Status: three separate states

| Item | Built | Technically passing (measured) | Human-approved |
|---|---|---|---|
| Rebuild plan (run / reuse / estimate / blockers) | yes | unit, HTTP and browser tests; two real rebuilds | no |
| Rebuild chain on the existing job runner (no second scheduler) | yes | unit tests with fake workers; restart tests | no |
| Edits during a rebuild: while a step runs, between steps, on retry | yes | unit and browser tests (section 4) | no |
| Jobs tray (states, progress, cancel, retry, recovery) | yes | unit, HTTP, restart and browser tests | no |
| Build selection and preview pairing | yes | unit and browser tests | no |
| Revision history, inspect, restore | yes | unit, HTTP and browser tests; real restore and redo | no |
| Worker-kill diagnosis and fixes | yes | seven regression tests that fail on the earlier code (section 5) | no |
| Placement measurement kept separate from final-output checks | yes | four regression tests (section 6) | no |
| One real rebuild with the approved voice | yes | section 7 | not approved. Later: the author watched this build and preferred it to the Phase 8 final (visual feedback only; `15-creative-benchmark-and-review-records.md`); it has not been signed off, and its words were not verified |
| Restart recovery of steps that were only waiting (found during the isolation work) | yes | one HTTP test (section 8.2) | no |
| Test isolation (own workspace, server, port and browser per test; heavy suites take turns) | yes | section 8.2 | no |
| Real-model hand-over through the real runner (one bounded run) | yes | section 8.4 | no |
| Slice 2 as a whole | yes | section 8 | **automated checks passing; user review pending** |

## 1. How to try the flow

```
./studio-app            # opens the app on the demo workspace (Ctrl+C stops it)
./studio-app --no-open  # prints the sign-in link instead
```

1. Edit a block of spoken text, a caption or an emphasis word. The header shows Saving, then Saved. The preview says the
   video does not match until rebuilt.
2. Press **Rebuild…**. The dialog says what will run, what is reused, and an estimate from recorded runs or "Not measured".
   A problem (for example a spoken edit that removes the word a scene waits for) is shown with advice and nothing starts.
3. Press **Start**. A pending edit is saved first; if the save fails or conflicts, nothing is queued. The **Jobs** tray shows
   the steps with elapsed time and real progress where the worker reports it.
4. When it succeeds the preview switches to the new build, labelled with its revision. If you edited meanwhile, the build is
   kept as an earlier build and the preview says so; **show the current one** goes back.
5. **History** has two tabs. Revisions: timestamp, what changed, **Inspect** and **Restore** (restore creates a new revision;
   later revisions, builds and takes stay). Builds: every video this workspace holds, **Preview this build**.

Technical details (job ids, hashes, artifact ids) are inside expandable details.

## 2. How it decides what to run

* Narration: one take per block, cache key = hash of the block's inputs and the fixed seed. Only blocks whose spoken text
  (or voice/pacing inputs) changed run; the others reuse the saved take.
* Timing: runs when a take changed. Captions and emphasis do not change the timing hash, so a caption or emphasis edit reuses
  narration and timing. Emphasis is re-applied by the render step from its own copy of the document.
* Mix: runs when timing or takes changed (or, with accents, the timing blob). Render: runs when any of its inputs changed.
* A stage whose inputs match an existing artifact is selected, not rebuilt (undo and redo of text reuse everything).
* Heavy steps stay on the runner's serial heavy lane; the model-unload check before render is kept.

## 3. Builds

One build is one rendered video, id `b<timing>-<mix>-<render or 0>`. The default preview is the build matching the current
timing, mix and render. Audio compatibility: same take blobs, pacing, gaps, blocks; with accents the mix's timing blob must
equal the timing blob. The Builds tab lists every build the workspace holds, including the imported revision-2 baseline.

## 4. Editing while a rebuild is in progress

The rule: **a step only ever starts on the text the rebuild began with.** If the saved text differs when the next step is
due, the rebuild pauses and says why. Nothing is run on new text, and no step is silently re-pointed at it.

| When you edit | What happens | What you see |
|---|---|---|
| While a step is running | The step finishes on the inputs recorded when it was queued. If the edit changed those inputs, the result is "Done, out of date", kept as an earlier build, never shown as matching, and the rebuild stops. If the edit did not touch that step's inputs, the step completes normally and the rebuild then pauses before the next step (next row). | State **Stopped**; the build is marked "Older than your edits" |
| Between two steps (a step finished, the next not yet queued) | The rebuild **pauses before the next step**. What finished is kept. **Continue** is refused (it would run on text the rebuild did not begin with). A `rebuild-paused` event records the reason. | State **Paused**, the reason, "Finished and kept: …", and **Rebuild with my edits…**, which opens the normal plan; anything finished that still applies is reused |
| Between two steps, and you undo the edit before the next step is due | The saved text is identical (compared by content hash) to what the rebuild began with, so it carries on. | Nothing unusual |
| After a step failed or was cancelled, then Retry | The retried step runs on **its own recorded inputs**, not the new text. If the text has moved on, its result is "out of date" and the chain does not continue. | **Stopped**; rebuild again to include the edit |
| The app restarts mid-rebuild | The step that was running shows as interrupted (**Retry**). A step that was only waiting is **not started** and is shown as cancelled with the reason ("the app restarted before this step started"), also with **Retry**; retrying one step is allowed while the others belong to the same rebuild. **Continue** is offered only if the text is unchanged since it began; nothing restarts by itself. | State **Failed** (a step was interrupted) or **Paused** |

Why pause rather than finish the historical build from the originally captured revision: finishing would spend minutes of
heavy work on text you have already replaced, and every remaining result would be out of date the moment it finished. This is
a choice, not a limitation of the store; the first rule above is what both options would have to satisfy. Any edit pauses the
chain, even one that would not change the remaining steps (for example a title change): that is deliberately conservative.

Tests (`tests/app/edit-between-stages.test.ts`, 3; the first two put the edit between the steps by saving it the moment the
earlier step's job settles; one browser test in `tests/app/rebuild.slow.test.ts` for the paused state and its button):

* the pause is entered, no later step is queued (also after waiting longer), the timing artifact is untouched, Continue is
  refused, and a new rebuild reuses the finished narration and completes;
* an edit that is undone before the next step does not pause it;
* a retry after the text has moved on runs on the recorded text (checked in the render spec the fake renderer received), ends
  "out of date", adds no step, and a new rebuild completes.

Existing tests cover the other rows (`jobs.test.ts`: edit while a step runs; `restart.test.ts`: restart).

## 5. The unexpected SIGKILL (job 11, attempt 1, 18:14 local time)

**What happened (from the recorded events).** The timing step's first attempt failed 1.5 s after it started, while
"loading the aligner", with `worker exited (SIGKILL)`. The automatic retry started at once and succeeded. No memory-guard or
cancel event exists for it, and the attempt's recorded pressure level was 1 (normal).

**Evidence used (all read from the demo workspace's job tables; nothing was regenerated).**

| Record | What it shows |
|---|---|
| `job_events` 94 to 99 | timing job queued 18:14:31.544; "loading the aligner" at .575; the failure at 18:14:33.083, 1.508 s after the handover began |
| handover record (event 98) | at .575: "switching from tts to aligner", outcome `killed`, "worker is not running", old worker 16 MB resident, 138 ms |
| `job_procs` | old worker 71077 gone at 31.691; **new** worker 72535 recorded at 31.736 under the same owner name `host:audio`; gone at 33.038 |
| narration job 10 | finished 18:14:23.338, but the next job was queued only at 18:14:31.544, 8.2 s later; its helper child (pid 71153) was recorded gone at 31.514 |
| first rebuild (jobs 6 and 7) | the same 8.5 s gap and the same "killed / not running" handover, but no failure: its replacement worker is recorded only at 18:12:14.584, after every record of the old one had closed (14.502) |

**Cause (established as far as the records allow; the signal sender itself was not observed, because the app did not log
signals).** It came from this app's own stop logic, not from memory pressure and not from an outside process:

1. The audio worker has a helper child (Python's `multiprocessing` resource tracker). It ignores SIGTERM, and after SIGKILL it
   stays as a zombie (a dead process its parent has not collected). I verified both on this machine with a small experiment
   on a process of my own. A finished job's cleanup treated that zombie as a live process it still had to stop, and kept
   retrying until the worker itself exited. In both real rebuilds the next step therefore started about 8 s after the narration
   job had finished.
2. What ended that wait was the idle shutdown, which stops the worker 8 s after the last job went idle. Its stop was an
   owner-wide kill, repeated until nothing owned by `host:audio` was left alive. It began at about 18:14:31.47 (the helper was
   re-recorded under `host:audio` at 31.473), and so the timing step was queued while it was still running.
3. The timing step started a **new** worker under the same owner name while that kill was still in its grace period. The kill
   saw it and, when the 1.5 s grace ran out, sent it SIGKILL (31.47 + 1.5 s = 32.97; the new worker was recorded dead at
   33.038, 65 ms later, which is about one process-table read). The attempt saw its worker die and failed; the automatic
   retry started a fresh one.

Not memory pressure: the failed attempt's recorded level was 1, and the sequence needs no memory event. (The two narration
attempts did record level 4, critical, while generating; that is unrelated to this death.) What was **not** possible: to
exclude an outside kill with certainty, since signals were not logged. The timing matches to within about 65 ms; the new
diagnostics (below) will state it directly if it recurs.

**Fixes.**

* Each worker process has its own owner name, so stopping one can never signal another.
* A worker being shut down is retired first: new work gets a fresh worker. Loading a model or unloading before a render waits
  until retired workers have exited (one model in memory at a time is kept).
* A zombie counts as dead everywhere processes are stopped or reaped.
* When a job ends, the lease on the borrowed worker and the helper children recorded for it are released without signalling
  anything; the worker stays up for the next job.
* The memory guard's stop is awaited when an attempt ends, so nothing it started outlives the attempt.

**Diagnostics added for any recurrence.** Every signal the app sends is logged with a reason, the exact process (pid **and**
start time, because a pid alone can be reused) and the worker generation (owner `host:audio#<n>`; a replacement gets the next
number). When a worker dies, the error text says whether the studio sent it a signal (which, and why) or sent none, and the
job's `failed`/`auto-retry` event carries `diagnostics`: exit code or signal, uptime, the signals the studio sent (each with
that identity), the last lines of the worker's stderr, a memory sample (pressure level, swap) and the attempt's highest
pressure level.

**Tests** (`tests/store/worker-lifecycle.test.ts`, now 9, and `tests/app/idle-shutdown.test.ts`, 1). The first seven: a stale handle stopping late leaves the replacement alone; a shutdown
in progress is not handed to a new job and does not stop its replacement; a model is not loaded while the old worker is still
exiting; stopping does not wait on a zombie; a finished job settles in under 2.5 s and leaves the worker and its helper
running; an outside SIGKILL is reported as "the studio sent it no signal"; a stop by the studio lists its signals and reason;
a crash records the diagnostics in the job event. **All seven fail on the earlier code** (the settle test measured 15.1 s
there) and pass now. The real Python resource tracker is used in the fake worker, so the helper-child behaviour is the real one.
Added in the follow-up: signals name the process identity and generation they went to, and none goes to the replacement (a
process is compared by pid **and** start time; start times have one-second resolution, so a start alone proves nothing); the exit
record carries the same identity; and at the job-service level, **a job that starts while the idle shutdown is winding the
worker down gets a fresh worker, runs once (no automatic retry), and no signal reaches that worker** (the idle check can now be
triggered directly by the test). With the previous shutdown behaviour put back (the worker still "current" while it exits) that
last test did not finish: it hung until I aborted it, which is how that race presents.

Not done: a real narration or timing run to watch the fix on the real models (no repeated generation by design). The fake
worker covers the process behaviour, not model loading.

## 6. Timing validation (the invalid placement figure)

**What was wrong.** The saved `measurements.json` of the sample held `placement_worst_ms: 2110` and `placement_pass: false`.
It had been measured on the final audio, which contains 16 sound accents; an energy detector reads an accent next to a word as
part of the word. The report said "ignore it", which is not acceptable for a number in a results file.

**What changed.**

* `scripts/phase2_measure.py` now writes schema 2 with two separate parts. `final_output` (mastered WAV and decoded MP4
  loudness and true peak, lag, duration) is always measured. `voice_only_placement` is measured **only** on speech alone:
  on a supplied voice-only WAV, or on the MP4 audio when the caller states the mix has no accents. Otherwise it is
  `{"available": false, "reason": "…"}` with **no number at all**.
* `scripts/phase4_measure_build.ts` rebuilds the voice-only file for a build from that build's own mix inputs: its saved
  takes, its recorded layout and gain, through the same mix script, with no accents and no mastering. It refuses if the
  rebuilt length differs from the mix's recorded length or the mix script has changed. No narration is generated and the
  workspace is not changed. The inputs used are recorded in the result (`reconstruction`).
* `phase2_final.ts` and `phase3_run.ts` now say whether their mix has accents.
* The earlier file is kept as `out/phase4/slice2/measurements.v1-superseded.json` so the old figure stays traceable.

**Results for build `b11-12-13` (current revision 4 build; measured by the script, not judged).**

| Check | Result |
|---|---|
| Mastered WAV | -16.0 LUFS, true peak -1.7 dBTP, within tolerance (±1.0 LU; target +0.2 dB) |
| Decoded MP4 audio | -16.1 LUFS, true peak -4.7 dBTP, within tolerance |
| Global lag, MP4 audio against mastered WAV | 0 ms (tolerance 40 ms) |
| Duration, MP4 against timeline | 24.043 s against 24.02 s, 23 ms apart |
| **Voice-only placement** (8 segments, both edges of each) | worst **70 ms**, within the 80 ms tolerance, at the pre-set -40 dB threshold |
| Threshold sensitivity (information only) | worst 80 ms at -30 dB, 75 at -35, 70 at -40, **175 at -45, 220 at -50** |

The threshold sensitivity matters: at -45 and -50 dB the detector starts to pick up breaths and room noise and the figure
leaves the tolerance. The pass is for the threshold chosen before the run, and it is a consistency check of the layout
against an energy detector, not a ground truth about where words start. The sample files are unchanged (same checksums).

**Regression test** (`tests/store/placement-measure.test.ts`, 4): with accents in the final mix and no voice-only audio, placement
is `available: false` with a reason and contains no `worst_ms`, `pass` or `segments`; final-output checks are present and separate
in every case; with the voice-only audio the check passes, while the same boundaries read off the accent-bearing audio give over
500 ms (the misleading figure); declaring the mix accent-free measures the MP4 audio and says so. All four fail on the earlier script.

## 7. One real rebuild in the demo workspace (unchanged from the first hand-over)

Demo workspace only, approved voice and saved takes wherever valid, one job at a time.

* My own typo ("some a little room") went into the first real rebuild. It is kept as honest history (revision 3, the build
  with timing 3); I corrected the text (revision 4) and rebuilt. The revision-2 baseline is still a build (**Imported sample**)
  and revision 1 still restores to it.
* Plan shown before starting: 4 steps (narration for block b1 about 15 to 31 s, timing 2 to 20 s, mix about 1 s, render about
  28 s), total estimate 45 to 82 s from recorded runs. Actual about 58 s.
* One timing attempt failed with the worker kill described in section 5 and succeeded on the automatic retry.
* Undo and redo of the text reused every stage (no work started).
* A render started before an edit and finished after it is kept as an out-of-date build and was not shown as current.

Sample: `out/phase4/slice2/context-window_slice2_rebuilt.mp4` (git-ignored), with `mastered-mix.wav`, `timeline.json`,
`voice-only-placement.wav` and the corrected `measurements.json` beside it. The file is 1080 x 1920, 30 fps, 721 frames.
Not judged: whether the narration sounds natural, whether the words are right, whether the video looks good. That is yours to
listen to and watch.

## 8. Verification (exact, this session)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no errors |
| `npm test` (= `npm run test:ts && npm run test:py`) | TypeScript: 434 tests, 434 pass, 0 fail, 0 skipped. Python: 30 tests, OK (the `[FAIL]` lines in its output are expected failures of the historical regression fixtures) |
| `npm run test:slow` (the four browser and render files; `package.json` unchanged) | 29 tests, 29 pass, 0 fail, 0 skipped, 134 s. The files take turns through a lock (8.2) |
| `node --test tests/store/runner.test.ts`, four times in a row | 36 tests, 36 pass, 0 fail, each time, with about 5.9 GB of swap in use (8.3) |

The TypeScript count went from 428 to 434: two signal-identity tests, one idle-shutdown test, one restart test, and two more
in the runner file (one test became three, 8.3). No suite was run repeatedly without a reason; the repeats above target the one
file that had failed intermittently.

### 8.1 The selection failure (accepted as a documented limitation)

**What is known.** In the failing run, the test chose segment `s1`, typed a pause, and later found `s3` selected. That run's own
screenshot shows the pause on `s3` and `s3` selected, so the typing went to `s3`: the choice of `s1` had not taken hold, or was
undone, before the typing. The final assertion was a consequence. The earlier test had left `s3` as the stored selection, so
the page opened on `s3`.

**What I checked, and what it ruled out.**

* *Persisted selection.* The stored choice is read once, before the editor is shown; nothing re-reads it, and choosing a
  segment is the only thing that writes it. Not a cause of a later change.
* *Playback-driven selection.* The selection follows the playhead only while the preview is playing. I looked at a fresh page
  and at one that had just been clicked: it is never playing by itself.
* *Asynchronous navigation.* The link from the rebuild dialog closes the dialog and selects in one handler.
* *A click landing on a moving target.* The test clicks at the position it measured. I measured the segment's position after the
  page reported ready, in 24 page loads with and without the page's CPU slowed six times: it never moved.
* *Shared state.* Real, and fixed (8.2): the first failure left a deliberately invalid pause in the shared workspace, which is why
  the next four tests failed.
* *Load.* Not shown. The exact sequence (stored `s3`, open, choose `s1`, type a pause) ran 56 more times, 8 with the CPU slowed
  six times and 40 while the render and browser suites ran as background load, with no misplaced pause. The whole file ran six
  times alone and three times in parallel with the heavy suites, with no failure.

**Root cause: not established.** I could not reproduce it, so I am not attributing it to load or to the page. Accepted as a
documented limitation at the verification checkpoint: the tracer and the regression test stay, and it is investigated again only
if it recurs or new evidence appears.

**What changed so that a recurrence is explained.** The browser harness now records, from page load, every click, input,
preference request and change of the selected segment with times (`traceSelection`). Choosing a segment in a test now waits until
it is selected and, if it is not, fails right there with that trace, instead of failing minutes later in an unrelated place. A new
test (`choosing a segment and typing at once edits that segment, even when another one was stored by an earlier visit`) repeats
the sequence five times per run and checks, through the saved document, where the pause landed.

### 8.2 Test isolation

* `tests/app/rebuild.slow.test.ts` (12 tests) and `tests/app/browser.slow.test.ts` (11) now give **every test its own workspace,
  server process (own port), Chrome process (own profile) and tabs**, removed afterwards even when the test fails. Nothing a test
  does or leaves behind can reach another. A test that needs earlier work (a finished build, some revisions, an edit) makes it
  itself through the API. The built page is shared read-only.
* `tests/heavy-lock.ts`: the two browser suites and the two render suites take turns, whatever flags `node --test` is given
  (a lock in the system temp folder; a dead owner's lock is taken over). Reason: this Mac has 16 GB and uses swap during these
  runs; several Chrome processes plus a Remotion render at once made timing-dependent tests unreliable. Fast tests do not use the
  lock and stay parallel. This changes how the suites are scheduled, not what they check, and it did not replace the
  investigation in 8.1. `package.json` is deliberately unchanged: it is part of the render sources recorded for the demo
  workspace, so editing it would mark the demo's final video as needing a rebuild.
* Making the tests independent exposed a real recovery defect, reproduced on a fresh workspace: if the app stopped while one of
  two narration steps ran, the one that was only waiting stayed "queued" forever. Nothing ran it, but it counted as work in
  progress, so **Retry** on the interrupted step was refused and **Rebuild** stayed disabled. Now a step that was only waiting is
  cancelled when the app restarts, with the reason, and can be retried; retrying a step is allowed while other steps of the
  same rebuild exist. Test: `tests/app/restart-queued.test.ts`. I did not run that test against the earlier code. What I observed on the earlier
  code was the browser test timing out with the tray showing the interrupted step with **Retry** and the other step "Waiting"
  and never started; that Retry is refused while queued work exists is from reading the code, not from a captured response.

### 8.3 The resident-memory assertion

The guarantee is that the audio model's memory is released before a render starts: the worker reports nothing held **and** its
resident size is under a threshold, otherwise it is stopped and its exit confirmed. The old test also asserted that a worker
holding 400 MB *reads* above 350 MiB. That is not a property of this code: macOS compresses and swaps idle pages, so the
figure was 327 to 337 MiB in the failing runs (it passed on 6 of 9). The implementation is not wrong, so it is unchanged; the
threshold was not loosened. Instead:

* the fake worker publishes what it really holds, the test's process table reports a resident size derived from that, and the
  decision logic is exercised exactly: release is confirmed from the worker's own report (400 MiB before, nothing after) and
  the resident size (at least 400 MiB before, under 150 MiB after);
* a new test: a worker that **reports nothing held but keeps the memory** is caught by its resident size, killed, and the
  render starts only after it is gone;
* one test with no threshold checks that the real process table can be read for a worker.

Limit that remains: the operating system's resident size does not count compressed memory, so on its own it could understate what
a process holds. For the real model the worker's own report (framework-held bytes) is the primary evidence and the resident size
the cross-check; I did not change that design.

Not measured by automated tests: how it looks, or whether the layout matches the approved mockups.

### 8.4 One bounded real-model hand-over check

`scripts/phase4_handover_check.ts` runs the real runner, handlers and workers in a **temporary project** (the demo workspace,
the approved sample and the approved voice reference are not touched; the reference hash was checked before and after, and
Hugging Face was set offline so nothing could be downloaded). The smallest existing episode was used: one segment, "Twenty-four
fictional checks, all at a glance." (`samples/dense-pip-fixture`). One job at a time: narration (Qwen3-TTS, approved voice),
timing (forced aligner), final mix, final render. Report: `docs/studio/phase4-evidence/handover-report.json` (the run's log and
output are in `out/phase4/handover-check/`, git-ignored).

**Measured.**

| Item | Result |
|---|---|
| Stages (sequential, each attempt succeeded, no retry) | narration 9.3 s (2.96 s of audio, generated in 5.3 s), timing 1.7 s (aligned, not estimated), mix 1.0 s, render 7.6 s |
| Output | 4.97 s, 1080 x 1920 H.264 with AAC (sha256 starting `1b85aa2d`). Not judged: how it sounds or looks |
| Worker generations | one: `host:audio#1` (a worker and its helper child). It served both models; the model was switched inside it, with the release confirmed, so no worker restart was needed |
| TTS to aligner hand-over | released in 271 ms. The worker reported 4410 MiB held before and 0.3 MB active, no cache, afterwards |
| Before the render | released in 69 ms. The worker reported 1757 MiB held; resident size 1946 MiB before, 195 MiB after (threshold 1536 MiB). The render job started 70 ms after the hand-over; during it no model was loaded and the worker held at most 195 MiB |
| Signals | two, both SIGTERM, sent when the app shut the idle worker down at the end: to the worker and to its helper child, each naming owner `host:audio#1`, pid and start time |
| Memory | pressure level 4 (critical) in 3 of 19 one-second samples, all during narration, never more than 2 in a row (the runner stops a job after 5); the worker's own peak MLX use was 8.43 GB on this 16 GB Mac; swap in use rose from 5.6 GB to 13 GB and stayed there afterwards |

**What it found.**

* The two signals were a defect: a worker that had acknowledged "shut down" was signalled at once instead of being given time
  to exit. Fixed (the shutdown now waits, up to the kill grace, for the worker and its helper to leave on their own and signals
  only what does not) with a test that a graceful shutdown sends no signal. **That fix was not re-run on the real models**: this
  was the one real run asked for, and it costs the machine heavily (swap, above).
* Resident size is not a usable cross-check on this machine: before the TTS-to-aligner hand-over the worker held 4410 MiB by its
  own report while the process table showed 30 MiB (swapped or compressed). The worker's own report is the evidence that counts;
  this supports the limit stated in 8.3.
* The check script's own pass/fail marks as run: 9 of 11 passed. The two that did not: the signal check (the defect above) and
  a "no critical pressure" check that was stricter than the runner's rule (5 in a row); the script now uses the runner's rule,
  under which the saved samples pass (longest run 2).
* The hand-over appears twice in the job events (the host's record and the job's); known, harmless.

**Not covered.** A real run in which a worker is stopped or killed mid-job; the job service's own idle timer (the idle
shutdown was exercised directly); a second worker generation; more than one block.

## 9. Screenshots (`docs/studio/slice2-screenshots/`)

* `real-demo-workspace/` 01 to 06: taken from the running app on the real demo workspace after the build-history change,
  with read-only actions only (the workspace's counts were checked before and after: 16 jobs, 16 artifacts, 6 revisions, saved
  version 15). Current build, the rebuild dialog saying nothing needs rebuilding, the revision list with one revision inspected,
  the builds list (one entry per video), an earlier build previewed, the jobs tray with the earlier real rebuilds.
* `test-fixture-fake-workers/` 01 to 19: written by the browser tests on a temporary copy with **fake workers**, so they show
  states that would otherwise need real generation: stale edit, failed save, conflict, server down, plan and blocked plan, running
  jobs, a rebuild paused by an edit (18) and its plan (19), cancelled, interrupted, history, earlier build. The pictures are of the
  interface, not of generated media.
* `superseded-before-build-history/`: the first hand-over's screenshots, kept because they are the only record of the real
  rebuild while it was running. They predate the one-build-per-video change; the Builds list and a few labels differ now.

## 10. Design decisions

* Revision restore reuses the normal save path (a new revision), so conflict protection and draft recovery are unchanged.
* Estimates come only from recorded runs (`/api/measured`); with none, the plan says "Not measured".
* A rebuild paused by an edit offers a new rebuild, never Continue (section 4).

## 11. Limitations and what is unresolved

* Demo workspace only. The real studio store and runner have been exercised only on temporary projects and the demo;
  `init`/`adopt` is paused.
* The SIGKILL cause is established from records and an experiment, but the signal sender was not observed (section 5). The fix
  was verified with a fake worker (with the real helper child), not with the real audio models.
* The placement check is a threshold-based energy detector; its result moves with the threshold (section 6). It is not a measure
  of whether words sound aligned.
* Estimates are ranges from past runs on this machine; real durations vary.
* After a restart a paused chain needs a Continue click by design.
* Cancel stops only processes the runner recorded for that job; a process started by someone else is never touched.
* Any edit pauses a rebuild between steps, even one that would not affect the remaining steps.
* One browser-test failure (a segment choice that did not take hold) happened once, could not be reproduced in 56 targeted
  attempts and several full runs, and has no established cause (8.1). Accepted as a documented limitation.
* A real hand-over run costs the machine heavily (8.4: swap from 5.6 GB to 13 GB, an 8.4 GB model peak). The shutdown fix found
  by that run is covered by a fake-worker test only.
* The heavy suites run one after another by design (8.2); `npm run test:slow` takes about two and a quarter minutes.
* The Phase 3 parity measurement and the bundled-font proposal remain open as in [08](08-phase4-slice1.md) and the README.

## 12. Phase 4 completion checklist

Audited against the Deliver list and the five acceptance bullets in `05-implementation-plan.md` (Phase 4). "Measured" is what
a test or script recorded; "judged" is what only you can decide.

| Item | Status | Evidence |
|---|---|---|
| Navigation: rail and stage stepper | Built; only Episodes and Script are live, the other stages are shown as unavailable until their phases | slice 1, section 1 |
| Outline | Done | browser tests |
| Player preview (real Remotion Player, saved audio) | Done | browser tests; comparison below |
| Inspector forms | Done for spoken text, shown words, emphasis, pause. Scenes, layouts, beats, sources are shown, not edited (later phases) | slice 1 |
| Timeline lanes | Done, read-only | browser tests |
| Autosave indicator | Done, truthful | below |
| Revisions menu | Done: list, inspect, restore as a new revision | section 1, browser test |
| Jobs tray | Done | slice 2 tests |
| Stale badges | Done | below |
| Layout for small screens | **Interpreted as 1280 x 800 with collapsible panels** (the criterion that is measured). Below about 1180 px only the stepper labels hide; nothing narrower was designed or tested. Not claimed | styles; no test |
| **Acceptance 1:** autosave states are truthful, a stopped server shows an error, not "saved" | Pass (measured) | browser tests: injected save failures, a killed server, a conflict |
| **Acceptance 2:** a text edit turns the expected badges amber within one second; clicking shows what is stale and the cost | Pass (measured: 0 ms after the last keystroke was handled; the list shows 4 stale items with estimates) | `browser.slow.test.ts` |
| **Acceptance 3:** at 1280 x 800 no page scrollbars; collapsing the outline and inspector frees width | Pass (measured: preview area 580 px open, 876 px with the inspector collapsed, 1112 px with both) | `browser.slow.test.ts` |
| **Acceptance 3:** dragging the timeline edge stays between a minimum and maximum, double-click resets, sizes survive a reload | Pass (measured). **Added in this step:** a mouse drag of the real edge: 224 px to 274 px for a 50 px drag, 420 px (maximum) and 120 px (minimum) when dragged far, no page scrollbar at either end, 180 px survives a reload, double-click and Home reset to 224 px, arrow keys step 24 px. The test harness's drag was corrected to hold the button and move in steps; an earlier version appeared to show a defect that was the harness | `browser.slow.test.ts`, screenshot `20-timeline-resized.png` |
| **Acceptance 4:** preview and a rendered frame agree visually at three sampled times, by eye, recorded | **Recorded; by-eye judgement is yours.** Measured: SSIM 0.955, 0.950, 0.945 at 2.4 s, 9.5 s and 17.0 s (a rendered frame half a second away scores 0.937, three seconds away 0.889). The test now saves a sheet (preview on the top row, render of the same frame below) and the numbers. I looked at the sheet and noticed no difference, but the criterion asks for your judgement | `phase4-evidence/parity-sheet.png`, `parity.json` |
| **Acceptance 5:** keyboard path for add note, play and pause, next segment | **Pass; add note was missing and is now built.** `N` (outside a text field) opens a composer at the playhead with the text box focused, the time and segment shown, a type menu; Enter adds, Shift+Enter is a new line, Esc cancels; `+ Note` is a button reachable with Tab. Play and pause: Space. Next segment: `]` (previous `[`) | below; `browser.slow.test.ts` |

**The note feature, as built (only what the criterion needs).** A note is stored in the episode document as a review note:
text, type (voice, visual, copy, timing, factual, general), status open, the segment under the playhead, the playhead time, and
the render it was written against. It is saved through the normal autosave, so it is a revision with the summary "Note added"
and conflict protection applies. It is shown as a pin on the timeline ruler (click to seek) and in the inspector's Notes list
for its segment. A note changes nothing that is built: tests show every stage status and the rebuild plan unchanged, no amber
badge, the final video still fresh. Tests: `tests/app/notes.test.ts` (4) and one browser test covering N, focus, the stamp,
saving, the marker, the list, Esc, a letter typed in a field not opening the composer, and the button.

**Still missing, and why it is not Phase 4.** Editing, resolving, dismissing or deleting a note; note rounds; re-anchoring a note
when its segment is edited; export to Markdown or CSV (specified in `02-product-spec.md` section 10, belonging to the review
stage, Phase 7). The `Cmd+K` command palette named in the mockup is not built and is not in the Phase 4 acceptance. The
approved-mockup match, and whether the editor feels right, are your review.

**Open from earlier steps, unchanged.** Slice 2's review pending; the demo workspace is untouched by this step.
