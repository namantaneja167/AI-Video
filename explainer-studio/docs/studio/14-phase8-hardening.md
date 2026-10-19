# 14 · Phase 8: hardening and core-workflow acceptance

Status: **implemented and technically verified by the checks listed here; not human-approved.** Nothing about the voice, the look of any video
or any approval is recorded as judged: listening, viewing and approving are yours. Approval and export were exercised only in isolated test
projects with explicitly simulated sign-offs. The real demonstration video (Phase 7) and the new journey episode are left awaiting you.

Scope kept: no packaging, publishing, 3D work or external-tool integration was started. Real-checkout `init`/`adopt` is still paused (the app now
refuses to open this checkout as a project). Protected paths (`reference/pip-voice/approved-v1/`, `prototypes/pip-scene-10x-v1/`, `episodes/*`,
`src/art`) are unchanged, and so are the narration takes, the baseline episode (`context-window`, seq 15, hash `59396c69a98c…`) and the Phase 7
demo's revisions and builds (their earlier builds are kept).

## Three words, used strictly

| Word | Meant here | Examples |
|---|---|---|
| **Implemented** | The control or behaviour exists in the app. | Project screen, `./studio-app new`, bundled-font default |
| **Technically verified** | A check ran in this work and its result is recorded with counts, or a measurement was taken. | test counts below, the clean-snapshot run, the backup restore comparison, timings |
| **Human-approved** | You listened, looked, decided. | **Nothing.** Not the narration, not any video, not the bundled fonts' look, not the Phase 7 demo, not the new journey episode. |

## What was done, against the request

### 1. The complete journey, on a separate episode in a separate project

The app can now create and open its own persistent project (section 5), so the journey did not touch the seeded demo. A new project was made with
`./studio-app new projects/journey`, and the episode "Why a model forgets the start of a long chat" went through, in the real page with the real
tools, by `scripts/phase8_journey_ui.ts` (resumable; evidence in `docs/studio/phase8-evidence/journey/`, with every run's log):

create (brief) → research (a broken paste refused with the exact place, then a good one accepted) → script import and review (split and joined by
hand, accepted exactly as seen) → storyboard (accepted) → apply scenes (previewed, applied; three `pip-cards` scenes) → voice (real Qwen3-TTS
narration) → draft video → a review round on the draft with one note → final video → production checks on both.

Measured, on this machine (a 15.8 s episode, 49 words, one narration block):

| Step | Time |
|---|---|
| create, research, script and storyboard through the page | 1.5 s |
| narration, one block, real model, **including** loading it | 17.9 to 18.2 s (three runs) |
| word timing (real aligner) | 1.4 to 3.2 s |
| draft video / final video | 17.8 to 22.0 s / 17.9 to 19.8 s |
| production checks, per video | 8.5 to 11.1 s |

Saved narration was **not** reusable here, by design: a take is saved per episode and per exact text, and this episode had none. It was reused
for every later build (the draft and the final each ran with "narration: current"; no narration job ran after the first). Reuse of saved takes
across edits is covered by the job tests (undo restores the segment exactly and nothing is regenerated).

Result of the checks on the **final** video: 23 pass, 0 warning, 0 fail, 2 not examined by the app (that no word was dropped; whether the join
between blocks is audible: both are yours), 1 information; loudness measured at -16.0 LUFS and -4.7 dBTP; fonts: Inter in use. The draft:
21 pass, 0 fail, 2 not examined, 2 information (not mastered, as a draft). A clean installation repeated the same journey from scratch with the same
outcome (section 3).

**Left for you:** `projects/journey` (app on port 4318): a draft and a final video, one open note (written by the journey run and labelled "[Phase 8
journey test note]": resolve it or ignore it; it records no listening), no review round on the final, no confirmation ticked, nothing
approved, nothing exported. The files are `out/phase8/journey/*.mp4` (git-ignored).

**Gaps, dead ends and misleading states found by the journey and the audit, and what was done** (all are fixed unless marked):

| # | Found | Severity | Fix |
|---|---|---|---|
| 1 | The app could only open the seeded demo; a real project could not be created or opened | Blocker for the core app | `./studio-app new <folder>` and `open <folder>`; the checkout and any non-empty folder are refused (section 5) |
| 2 | The production checks **failed a correct video**: the probe measured text before the bundled fonts were in the document, reporting "Inter is not in use" | Wrong result | The probe now waits for the same single font load the render waits for (`loadBundledFonts`) |
| 3 | The checks **failed a correct video**: a card overshooting the safe area for a few frames while it enters was reported as an overlap | Wrong result | Elements still moving into place are not judged for position; if an element is only ever seen mid-entrance the report says "not examined", it does not pass or fail it (`layout.entrance`) |
| 4 | The Review screen kept showing an old, already-recovered failure ("narration failed: memory pressure…") above a finished video | Misleading | Only failures with no later success or running job are shown |
| 5 | A compact backup **failed outright** ("FOREIGN KEY constraint failed") when a review round existed on a draft video | Recovery blocker | Backups drop the rounds of videos they do not carry and say how many; complete is now the default for the command line and the page |
| 6 | A backup did not keep the check report an approval rested on, nor the reports of kept videos | Provenance gap | Kept by backup and by clean-up |
| 7 | No way to back up from the app; the command line refuses a project the app has open | Recovery gap | Project screen: **Back up now** (verified), with the restore steps |
| 8 | Dialogs: Tab left the dialog, and Escape worked only while focus was inside it; focus was lost on closing | Keyboard | One shared behaviour for all four dialogs: focus in, Tab trapped, Escape from anywhere, focus returns to what opened it |
| 9 | A link to an episode that does not exist silently showed the list | Misleading | A plain notice names the missing id |
| 10 | No connection notice on the Planner, Voice and Review screens when the app was stopped or restarted (the editor had one) | Misleading | A banner on every screen: lost, back, or restarted (with a reload button) |
| 11 | An empty project said only "No episodes yet." | Empty state | A first-run card: what an episode is, the steps, how to start |
| 12 | The Scenes preview said "no narration has been made for it" when narration existed | Misleading | Reworded to say it never uses narration or a build |
| 13 | Stepper stages 8 (Render) and 9 (Export) read "later" although both are done in Review | Dead end | They read "in Review" and lead there |
| 14 | A new episode defaulted to the system font stack; there was no control to change the typeface | Portability | New episodes use the bundled fonts; Scenes has a Typeface control (section 4) |
| 15 | `setup.sh` ran `npm install` and said nothing about the narration environment | Reproducibility | `npm ci`, and `./setup.sh --narration` creates `.venv-qwen`; `./studio-app doctor` checks the rest |
| 16 | The narration job once stopped by the memory guard on a busy machine | By design | Kept: it stopped, said why in plain words, and Retry worked (18 s). Close other apps first (README) |
| 17 | **A backup of the real demo project dropped the author's unselected re-roll takes** (the selected take was the same, but "take 2" came back as "take 1"); clean-up would also have collected them after the grace period, though the Voice screen says a take "stays saved" | Silent loss of saved narration | Found by restoring a real project and comparing; **every saved take, selected or not, is now carried by backups and never collected** (tests for both) |
| 18 | The Phase 7 demo's videos were listed as out of date after the probe fix (a render source changed) | Consistency | Remade through the app's own routes with narration reused: the bytes are identical (same SHA-256), still unreviewed, nothing ticked (`phase8-evidence/demo-refresh/`) |

Still open from the journey: the layout fit check at apply time does not model entrance overshoot or font metrics, so the production checks
(which measure the real frames) are the authority; and the first-run demo cannot be created in a checkout without the saved outputs (section 5).

### 2. Recovery and relocation

* **Backup** (`core/backup.ts`, the Project screen, `node scripts/project.ts backup <dir>`): self-contained, checksummed, verified after writing.
  Carries episodes, revisions, every saved take (selected or not), the current builds, notes, review rounds, playback, sign-offs, check reports, approvals and what they rested
  on, and the approved voice reference. Does not carry `node_modules`, the Python environments, model weights or exported packages
  (restored separately, below).
* **Restore** (`node scripts/project.ts restore <backup> <empty folder>`): verifies the whole manifest and every file before writing, stages in a
  sibling folder, runs the normal recovery on it, publishes with one rename; a damaged backup, a non-empty target, or an interruption leaves
  nothing behind.
* **Relocation:** nothing in a project refers to where it lives (a test reads every column of every table of a restored project looking for the
  old path and finds none). The one recorded path is an export's folder, kept as a historical fact.
* **Tests** (`tests/store/backup-review.test.ts`, 8): a reviewed project (round on the draft with a note, round on the final with SIMULATED
  playback and sign-offs, check reports, approval) is backed up, restored to a different path, and compared: document, revisions, builds, takes,
  notes, rounds, playback, sign-offs, approval (still valid) and check reports all equal, no foreign-key problems, verify clean. Also: a compact
  backup; one changed byte, a missing file, a changed database and a missing manifest each refused with nothing left behind; a non-empty target
  refused; an interrupted earlier restore does not stop a new one; a missing build file named on open and a backup refused until it is clean.
* **Real projects** (`scripts/phase8_restore_check.ts`; evidence in `docs/studio/phase8-evidence/recovery/`). For each of the two real projects, with
  its app running: a backup was made **by the app** and verified, restored into a fresh path under the temp folder, a second app was started on
  the restored copy, and the two apps' answers were compared for every episode.

  | Project | Backup | Restore | Compared equal, original against restored |
  |---|---|---|---|
  | the demo workspace (4 episodes: the baseline `context-window`, the Phase 7 demo draft, two drafts) | 163 stored files, 35.4 MB, 0.13 s | 0.12 s, no missing files, no interrupted jobs | documents and hashes; revision lists (6, 4, 2, 1); every video by SHA-256 (the bytes served by the restored app match their hash); selected takes **and** the take audio bytes; notes; approval and confirmation records |
  | the journey project (1 episode) | 135 stored files, 9.1 MB, 0.07 s | 0.06 s | the same, 4 videos, 3 revisions |

  Damaged copies of each backup (one changed byte, a missing file, no manifest, a truncated database) were each refused with nothing left behind;
  restoring into a folder holding a file was refused and the file untouched; the original backup stayed intact. **What this does not show:** the
  real projects have no approval (none was made), so approval provenance after restore is verified only in the isolated test projects with
  simulated sign-offs. The first run of this check failed on the demo project, which is how item 17 above was found.
* **Interrupted work** was already covered by earlier phases (`restart`, `restart-queued`, `shutdown`, `worker-lifecycle`, `recovery`); this
  phase added no new mechanism. After a hard kill the page says the app was restarted and that running work was stopped; the step shows as
  interrupted with Retry.

**Restoring a machine from nothing:** (1) install Homebrew packages (`brew install ffmpeg python@3.12`); (2) get the source (this checkout);
(3) `./setup.sh --narration`; (4) `./studio-app doctor`; (5) fetch the two voice models only if `doctor` says they are missing (the command is
printed); (6) restore the project folder from its backup; (7) `./studio-app open <folder>`.

### 3. Clean source snapshot

Method (`/tmp` copy, scripted): the complete **current** source, i.e. every tracked file and every untracked file that git does not ignore
(599 files, 65 MB, at the first snapshot: 333 tracked, 266 untracked; 612 at the final one), without `out/`, `build/`, `public/generated/`, `app/dist/`, `demo-workspace/`, `projects/`, any
`.studio/` (no project database), `node_modules` or the Python environments. Nothing was discarded or tested from HEAD only.

Setup run **inside the snapshot**, with empty caches so everything was downloaded, not reused:

| Piece | How | Status |
|---|---|---|
| Node packages | `npm ci` with an empty npm cache (`npm_config_cache` pointing at a new folder), 255 packages | **freshly installed** (62 MB downloaded) |
| Python `.venv` and `.venv-qwen` | `PIP_NO_CACHE_DIR=1 ./setup.sh --narration` into new virtual environments | **freshly installed** |
| Remotion's headless browser | `npx remotion browser ensure` | **freshly downloaded** into the snapshot |
| Voice and alignment models | not part of a checkout | **reused** from the existing Hugging Face cache, never downloaded; the snapshot imports `mlx-audio` and loads the model from that cache |
| Not a clean-install test | a symlinked developer environment | not used anywhere |

Setup took 84 s. `npm` printed one warning, that esbuild's post-install script is not yet approved (npm's new script gate); the page bundle builds
and the app runs without it.

Results in the snapshot:

* `npx tsc --noEmit`: clean. `./studio-app doctor`: everything present (the render browser until fetched).
* **The first run failed**, and that was the point: 66 test setups died with "cannot seed the demo: missing out/phase3/…". The seeded demo, and
  through it most app tests, depended on **saved outputs that are not in the source** (git-ignored `out/`). Fixed: the small data files (the
  revision-2 timeline and two reports) are now test fixtures (`tests/fixtures/baseline/`), and the audio and video are stand-ins made with
  ffmpeg when the real outputs are absent (`tests/baseline-sources.ts`); with the real outputs present nothing changes.
* After that: `npm run test:ts` **720 of 720 pass**; `npm run test:py` 30 of 30 pass; the slow suite found two tests that need pipeline outputs
  never committed (`public/generated/…` from `./studio narrate`, which downloads the Kokoro model, and `out/pip_scene_10x_v1.mp4`); they now
  **skip with that exact reason** instead of failing or passing. They still run, and pass, in this checkout.
* The **whole journey** of section 1 was run again from the freshly installed snapshot on a new project: narration 17.9 s, draft 22.0 s, final
  19.8 s, checks 9.5 s each; draft 21 pass / 0 fail, final 23 pass / 0 fail (`docs/studio/phase8-evidence/clean-snapshot/`).
* `./studio-app` (the demo) in a checkout without the saved outputs now stops with a plain message pointing to `./studio-app new <folder>`.

A final snapshot was taken again from scratch after the last code change; see "Final regression".

### 4. Fonts and layout coverage

* New episodes are created with the bundled fonts (`pip-paper-bundled`: Inter and JetBrains Mono, SIL OFL 1.1, checked against their manifest
  before every render). The Scenes step has a **Typeface** control: bundled (production) or the system stack (the prototype comparison, unchanged
  and still selectable). Changing it saves like any episode edit and marks only the video stale; the narration is not touched.
* The journey episode's final video: "Inter in use", measured in the same browser engine that renders it.
* **The Phase 7 demo ("Voice demo: prompts") keeps the system style**, so its SF Pro fallback warning remains and is correct: that episode asks for
  fonts that are not installed where the check runs. It was not changed because it is the video you are reviewing. To remove the warning: open
  its Scenes step, press "Use the bundled fonts", make a new draft and final.
* **Honest coverage:** the frozen prototype scene (`pip-scene-10x`) always draws its own system stack, even in a bundled-font episode, and is not
  instrumented. A bundled-font episode that contains it now says so in the checks ("Scenes that do not use the bundled fonts", not examined).
  Scenes without marked elements are still reported as "only partly checked"; custom scenes still get generic checks only.

### 5. The supported app, and the demo-only audit

**Demo-only restrictions found:** the app opened only the seeded demo (`app/main.ts`), said "Opening the demo workspace", and the demo could not
be created without saved outputs. Removed or documented:

| Command | What it does |
|---|---|
| `./studio-app new <folder> [--name N]` | creates a new project in a missing or empty folder; refuses a folder with anything in it, an existing project, a project inside another project, the home folder, a parent of this checkout, **this checkout** and anything in it (except `projects/`, which git ignores), also through a symlink |
| `./studio-app open <folder>` | opens an existing project; never creates; refuses a folder that is not a project and a project already open in another process, with a message |
| `./studio-app` | the seeded demo, as before; reset only with `reset-demo --yes`, which moves the old one aside |
| `./studio-app doctor` | what this computer has and how to fix what is missing; exit code 1 if editing, review and rendering are not ready |

A project is configured with the production settings the demo uses (the approved voice reference, models, mix, mastering, render settings), but
has no episode and no accents. Tests: `tests/app/workspace.test.ts` (6). Adoption of this checkout stays paused; nothing here can overwrite a
project.

**Hardening audit** (`scripts/phase8_audit_ui.ts` on a throwaway project; `docs/studio/phase8-evidence/audit/`; kept as a browser test in
`tests/app/hardening.slow.test.ts`, 7 tests):

| Area | Before | Now |
|---|---|---|
| Empty states | one line | first-run card; empty Voice and Review say what is missing |
| Invalid input | already refused with words (title, length, duration, pasted packets) | unchanged; confirmed through the page |
| Keyboard | editor keyboard paths existed and are tested | dialogs: focus trap, Escape, focus return (4 dialogs); the Project screen and every control reachable by Tab |
| Connection loss | editor only | banner on every screen; restart announced |
| Graceful shutdown | tested (`shutdown.test.ts`); SIGTERM stops the app cleanly (observed) | unchanged |
| Job recovery | tested (restart, queued restart, worker lifecycle) | unchanged; a stale failure no longer shown once recovered |
| Error messages | plain for save, import, job failure | backup and project errors in plain words with what was not changed |
| Unknown links | silent list | named notice |

**Supported environment.** macOS on Apple silicon for narration (MLX); editing, review, checks and rendering also need Node 24 or newer (developed
on 26.4), ffmpeg and ffprobe, Python 3.12 and the Remotion browser. **Viewport:** 1280 x 800 is the supported size; the Review, Voice, Planner,
Scenes and Project screens were opened at 1280 x 800, 1024 x 700 and 900 x 700 and the page itself did not scroll at any of them (internal panels
scroll). Below 900 px wide was not examined and is not supported. Memory: the narration worker's resident memory is small, but MLX's own memory
peaked at 8.1 to 9.7 GB in Phase 6 on this 16 GB machine; one narration job stopped by the guard when the machine was busy (item 16).

**Measured performance** (`scripts/phase8_perf.ts`, idle machine, `docs/studio/phase8-evidence/perf/perf-run.json`): the app starts in 0.11 s
(5 runs, 112 to 123 ms); the first screen is usable in about 0.2 s; creating a project takes about 1 s (it hashes the render sources and
copies the voice reference); the page bundle builds in 56 ms; a page request takes 1 to 2 ms; a backup of a small project is written and verified in
about 0.05 s (the real projects below took longer because of their videos). Heavy work, from the journey: a 15.8 s episode took about 18 s to
narrate (first block, with the model load), 18 to 20 s per video render (about 1.2 times the video's length) and 9 to 11 s per set of checks.
**Practical expectations** (this machine, not a promise): editing and navigation are instantaneous; for a one-minute episode expect roughly 1 to
2 minutes of narration, 1 to 2 minutes per video render, and 15 to 40 s per set of checks, one heavy job at a time. The app shows an estimate from
what it has measured on this project, or says "Not measured"; it does not extrapolate across machines.

### 6. Verification and documentation

* **The unexplained rebuild-test failure** (`rebuild.slow.test.ts`, "editing while a step runs"): the test compared a preview label with a read
  taken before the page had refreshed (fixed in Phase 7), and then failed once in ten further runs without a captured reason. Its running step
  is now long enough to outlast the page catching up, and the test writes `docs/studio/phase8-evidence/flake/rebuild-editing-while-step-runs-*.json`
  (its timeline of events, the page's label, the server's builds and jobs) if it fails again. The mechanism was exercised once on purpose to
  prove the file is written, then the deliberate failure was removed. No retries were added. If it recurs, that file says where the time went.
* A second timing-sensitive test failed once under load and is recorded the same way: `voice-ops.test.ts` "over a whole generation the engine view
  and the job table agree" asserted that it had read more than 20 samples; it read 20 with **no** disagreement between the engine and the jobs.
  The sample-count sanity check was lowered to 5; the assertions that matter (no violations, loading and generating both seen) are unchanged.
* **Licences** (read from the official sources, see "Licence position"). Nothing was accepted on your behalf.

## Licence position

Read from official sources on 2026-10-19. This records what they say; **it is not legal advice and it does not decide which category you are in.**

* **Remotion 4.0.536** (the installed version; its `LICENSE.md` matches the text at `github.com/remotion-dev/remotion/blob/main/LICENSE.md`).
  Free for: an individual; a for-profit organisation with up to 3 employees; a non-profit; or evaluating without commercial use. Free use covers
  commercial video creation. **Any other for-profit organisation needs a Company License** (see remotion.pro). Not allowed under the free licence:
  copying or modifying Remotion to sell, rent or sublicense your own derivative. The page notes that **Remotion 5.0 changes the licence slightly**
  (the pull request is linked from the licence), so upgrading is a decision to revisit it. **Which category applies depends on who publishes
  videos made with this app, and only you can say.** Phase 8 of the plan asked for the position to be recorded; recording it is all that was done.
* **Bundled fonts:** Inter (Copyright 2016 The Inter Project Authors) and JetBrains Mono (Copyright 2020 The JetBrains Mono Project Authors), both
  **SIL Open Font License 1.1**, copies with their licence texts in `public/library/fonts/` and recorded with SHA-256 in its manifest. The official
  text (`openfontlicense.org`) permits use, bundling and redistribution with software provided each copy carries the copyright notice and the
  licence, the fonts are not sold by themselves, and modified versions do not use a Reserved Font Name. The fonts are unmodified. Text and videos
  made *with* the fonts are not bound by the licence.
* **Art in `public/assets/`:** Lucide (ISC, with some Feather-derived icons under MIT; official page confirms) and Simple Icons (CC0 1.0 package;
  **the logos remain trademarks of their owners**, so check a brand's guidelines before showing one) match their local licence files. 3dicons: the
  official repository declares CC0-1.0 and the local file is CC0; the files in use were fetched from the site's own image storage and the page that
  answers "What license is 3dicons?" could not be read in this session, so **that one is confirmed at repository level only**.
* **Not covered here:** the voice model and the alignment model (their own licences, never downloaded by the app), the approved Pip voice
  reference (yours), the Pip art (yours), Python and npm dependencies (not audited one by one).

## Final core-feature checklist

Each line: implemented (I), technically verified (V, with where), human-approved (H). H is empty throughout.

| Feature | I | V | H |
|---|---|---|---|
| Create and open a separate persistent project; refuse the checkout and overwriting | yes | `workspace.test.ts` 6, CLI run | |
| Environment check (`doctor`, Project screen) | yes | `project-api.test.ts`, run here and in the snapshot | |
| Idea, research, script, storyboard import with review and refusal of bad input | yes | `planner.slow`, journey | |
| Apply scenes, typeface control, scene checks | yes | `planner.slow`, `pipcards`, journey | |
| Voice: generate, re-roll, select, split and join, engine state | yes | `voice*` tests, journey (real) | |
| Draft and final builds, rebuild plans with estimates, history | yes | `rebuild*`, `jobs`, journey | |
| Production checks (measured, heuristic, partial, human) | yes | `checks.test` 36, `probe.slow`, journey | |
| Review notes and rounds, playback coverage, sign-offs | yes | `review*` tests, journey (note) | |
| Approval bound to file and inputs; export of the exact bytes | yes | `review-jobs`, `export.test`, simulated only | **you** |
| Backup, verified restore elsewhere, damage refused | yes | `backup-review.test` 8, `backup-gc`, restore check on real projects | |
| Connection loss, restart, shutdown, job recovery | yes | `hardening.slow`, earlier suites | |
| Clean install and the whole journey from a snapshot | yes | section 3 | |

## Known limitations, ranked by practical impact

1. **No listening or viewing has been done by anyone.** The checks cannot find a dropped word or judge a join or a look; every video is unreviewed.
2. **Narration needs an Apple silicon Mac and about 10 GB of free memory**, and stops (saying why) if the machine is under sustained memory
   pressure. Retrying after closing apps works.
3. **The saved takes belong to one episode and one exact text.** A new episode never reuses another's narration, and the voice models must be
   fetched by hand on a new computer.
4. **The Remotion licence category is yours to decide** before anything is published; Remotion 5 changes the terms.
5. **A backup is on the same disk** until you copy it elsewhere, and does not hold the voice models, the Python or Node environments or exports.
6. **Restoring is a command, not a button** (it needs the app stopped); backing up is a button.
7. **The production checks sample 23 to 30 frames**, measure only elements scenes mark, and do not judge entrances; a scene that is not
   instrumented, or the frozen prototype scene, is reported as not examined.
8. **The layout fit check at apply time is an estimate**; the checks on the real frames are the authority, and they run on the video, after it
   exists.
9. **The Phase 7 demo cannot be recreated** in a checkout without the saved outputs (it says so and points to `new`); its video still uses the
   system fonts and shows the SF Pro warning.
10. **The jobs run one at a time**; two apps on two projects can both start heavy work. Run one heavy job at a time.
11. **Below 900 px wide, and browsers other than Chrome, were not examined.**
12. **Sign-offs and playback record that something was done**, not that anyone paid attention.
13. **Test-suite timing sensitivity remains** in a few browser tests under heavy load; failures write diagnostics where this phase added them.
14. Real-checkout adoption, packaging, publishing and any other production tool are not built, by instruction.

Do not read the list as "finished": the app implements the core workflow and recovery described, and every statement of that kind is limited to
what was measured here. Whether the videos are good, the voice natural, the fonts right and the licence position acceptable is yours to judge.

## Final regression

Run on the settled code in this session (the last code change was before these runs; the documents were edited after, which the Python README check
reads, and it was run last).

| Where | Command | Result |
|---|---|---|
| this checkout | `npx tsc --noEmit` | clean |
| this checkout | `npm run test:ts` | **721 tests, 146 suites: 721 pass, 0 fail, 0 cancelled, 0 skipped** |
| this checkout | `npm run test:py` | 30 tests, OK |
| this checkout | `npm run test:slow` (real browser, renderer, ffmpeg) | **61 tests, 10 suites: 61 pass, 0 fail, 0 cancelled, 0 skipped** |
| **final clean snapshot** (612 files, new folder, `npm ci` and both Python environments installed fresh with empty caches in 74 s, Remotion browser downloaded fresh, models reused from the existing cache) | `./studio-app doctor`, `npx tsc --noEmit` | everything present, clean |
| final clean snapshot | `npm run test:ts` | **721 tests: 721 pass, 0 fail, 0 skipped** |
| final clean snapshot | `npm run test:py` | 30 tests, OK |
| final clean snapshot | `npm run test:slow` | **61 tests: 59 pass, 0 fail, 2 skipped**; the two skips are the legacy render comparisons that need pipeline outputs (`public/generated/…` from `./studio narrate`, which downloads the Kokoro model, and `out/pip_scene_10x_v1.mp4`), skipped with that reason |
| final clean snapshot | the whole journey with real narration (`phase8-evidence/clean-snapshot/final-journey-run-in-snapshot.json`) | narration 17.9 s, draft 21.7 s, final 19.4 s, checks 9.4 to 9.5 s; draft 21 pass / 0 fail, final 23 pass / 0 fail |

Runs that failed on the way (all fixed, none retried away): the first snapshot run (demo-seed dependency on `out/`; section 3); two tests that
assumed unselected takes could be collected (changed with the take policy, item 17); one timing-sensitive sample count (section 6); the Python README
check before this document existed. The fast suite was run on the working tree three times in this phase after the last of these.

**What the tests do not show.** Approval and export were run only against isolated projects with simulated sign-offs. The browser tests drive a
headless Chrome only. Whether anything sounds or looks right was not and cannot be tested.

## Where things are

* Apps left running: the Phase 7 demo on port 4317 (`./studio-app`) and the journey project on port 4318 (`./studio-app open projects/journey --port 4318`).
  Only one heavy job should run at a time across them.
* Recovery backup after this phase: `../backups/explainer-studio-phase8/` (source tarball of the whole repository's current files, `out/`, a verified
  project backup of each real project, a manifest of SHA-256 values and a record); the earlier `../backups/pip-baseline-phase3-rev2/` is untouched.
* Evidence: `docs/studio/phase8-evidence/` (`journey/`, `audit/`, `recovery/`, `clean-snapshot/`, `perf/`, `demo-refresh/`, and `flake/` which is empty
  until that test fails again).
