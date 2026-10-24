# 16 · The Pip Explains opening in the normal episode workflow

Status: built and technically verified as listed below; **not approved by anyone**. The author's liking of the branded caching video is
recorded as positive visual feedback on that build and its cover (`docs/studio/benchmark/benchmark.json`,
`15-creative-benchmark-and-review-records.md`); it is not export approval, not verification of the words, and not approval of any other build.
Pip's design, the approved voice, the renderer and the scene library are unchanged, no 3D work was done, and no file under `src/` was edited
(see "A rule this work had to respect").

The standard itself is `docs/studio/pip-brand-standards.md`. This document is what the app now does about it.

## 1. What a person does now

1. **Idea.** *New episode* starts a draft marked as a Pip Explains episode (`brand: "pip-explains"` in its planning document). Older plans carry no such mark and are left as they were.
2. **Hook and script.** On the **Script** step, once the script is accepted, an **Opening hook** card appears. The hook is the first scene's `openingHook`. It is saved through the normal episode save (a revision, with the sequence check) and checked by the episode's own schema: 1 to 48 characters after trimming, first scene only, Pip-style only. The descriptive title is shown next to it and is never touched. Four to eight words is advice, not a rule. The card shows the shared opening (banner, hook, Pip's entrance) in a three-second player on an estimated clock, and the quiet **opening chime** (see 3).
3. **Scenes.** The same card sits at the top of the **Scenes** step, above the composition preview. Applying a storyboard replaces the episode's scenes; the hook on the first scene is **carried onto the new first scene** unless the storyboard sets its own.
4. **Render.** A Pip Explains episode **cannot be built until its hook is set**: the rebuild plan says so and where to set it.
5. **Cover.** On **Review**, beside the video, a **Cover image** card draws the cover from *that* video, shows it, offers *Download cover*, and says whether it matches the video. The cover is an artifact of its own, tied to the video's artifact id and file hash.
6. **Export.** The approved package contains `<episode>-cover.png`, a byte copy of the cover made from the approved video, listed in `checksums.sha256` and described in `metadata.json` (`cover`: file, SHA-256, size, frame, hook, and the SHA-256 of the video it belongs to). A video with the branded opening is **not exported without its cover** (nothing is written, and the message says why). Older videos export as before, with no cover.

## 2. How each part works

| Part | What it is | Where |
|---|---|---|
| Hook | First scene's `openingHook`; validated by `EpisodeSchemaV2`; `withHook`, `hookProblems`, `openingPreviewDoc` are pure helpers | `app/shared/opening.ts`, `app/ui/OpeningHook.tsx` |
| New-episode defaults | `applyBrandDefaults` at the moment the episode is created from an accepted script: the chime recorded **once** for that episode only (`{t: 0.12, accent: "chime", gainDb: -21}`) and the quiet accent bus (`voiceGainDb 0, accentBusDb -12, accentDuck 0.7`) when the project has a recorded mix script. Typography was already the bundled fonts (`pip-paper-bundled`) | `core/brand.ts`, `app/planning.ts` |
| Chime exactly once | `ensureOpeningSignature` is idempotent: a second request changes nothing; several copies are reduced to one (other sounds are kept); `removeOpeningSignature` removes only the chime. Every change goes through `recordEpisodeSound`, so validation is the usual one and no other episode changes | `core/brand.ts`, `POST /api/episodes/:id/opening` |
| Hook required | `productionBlockers` adds a blocker for a Pip Explains episode whose first scene has no hook | `app/shared/storyboard.ts` |
| Cover job | Job kind `cover.build`, subject = the render artifact id. It reads the **video's own recorded snapshot** (document, timeline, settings), refuses if the render sources or toolchain differ from the recorded ones, and draws frame 20 (0.667 s: hook complete, Pip's hop finished) of the same `studio-episode` composition with the timeline's captions taken out, in the same browser engine. It checks the result is a 1080 x 1920 PNG | `core/handlers.ts` (`coverBuild`), `workers/still-worker.ts`, `core/cover.ts`, `core/coverSpec.ts` |
| Which render it belongs to | artifact kind `cover`, `subject` = render artifact id, `inputs_hash` = hash of the render's file hash + frame + drawing version | `core/artifacts.ts` |
| Outdated | computed, never stored: a cover is `fresh` only while its video is the newest of its kind **and** fresh. A hook, script, scene or sound change makes the video stale and the cover outdated with it; a newer video leaves the older cover with the older video | `core/cover.ts` (`coverFor`) |
| Download | `GET /media/cover/<episode>/<render>.png` (`?download=1` adds an attachment header). The page offers the download only while the cover matches | `app/server.ts` |
| Export | `exportApproved` copies the cover (never overwriting a different file, checked by SHA-256 before and after) | `core/export.ts` |
| Cleanup and backup | a kept video's cover is kept | `core/gc.ts` |

## 2b. Chapter header, stage strip and takeaway (reusable)

`src/library/chapters.tsx` holds the approved v5 structure as three small components: `ChapterHeader` (large title, one supporting sentence and the stage strip), `StageStrip` (every label visible, the active one charcoal on cream, the others muted paper grey) and `FullPageTakeaway` (one headline, at most two supporting points, an optional counter and scope note, and a slot for the topic's own mascot). They take plain strings, an active index and colours; they know nothing about any topic (a test fails if caching wording appears in the file). A topic supplies its stage labels, decides which stage is active from its own cues, and passes its takeaway wording; `CacheJourney.tsx` is the first user. A scene that needs more or fewer stages passes a different list. Nothing else in the scene system changed.

Two details of the caching scene that a later author should know: the first lookup starts on the word "first" of the second narration line and is read from the narration (`lookupStart`), not added as a stored cue, because a stored cue would be missing from timing that was made earlier and would have forced a new timing run; and the takeaway keeps v5's "5 / 5" counter, which is an option, not a requirement.

## 2c. A second topic through the same workflow: AI Maxxing 01 (tokens)

What the first run on a new topic showed, and what it changed:

* **Scene and data.** A new topic-specific scene, `token-journey` (`src/library/scenes/TokenJourney.tsx`), uses `ChapterHeader` / `FullPageTakeaway` with the stages TEXT · SPLIT · NUMBERS · COUNT · CHECK. Its params carry the tokenizer output (pieces, ids, counts) and the schema refuses pieces that do not spell the text or ids that do not match the pieces. The data comes from a recorded run (`samples/ai-maxxing-01/tokenizer-evidence.json`, written by `tokenize_examples.py` from tokenizer files already on the computer); a test compares the scene's params with that file and the script's spoken numbers with it. One tokenizer of one model family was available, so the difference between models is stated from the cited source and drawn as a dashed "not shown" row, never as invented output.
* **A gap found and fixed: new cue rules block timing.** The cue rules (`src/library/sceneSpecs.ts`) are part of the recorded *timeline logic*. Adding a scene's cues changes that fingerprint, and the plan then refused to time any episode ("the timeline logic files changed since they were recorded"), with no supported way to record it again. Now an episode that has **never been timed** adopts the current logic for itself when its rebuild starts (a note says so); the project-wide record and every other episode keep what they recorded, and an episode that already has timing still gets the refusal (`tests/app/timeline-logic.test.ts`, 2 tests; mutation-checked). A new cue that an older timeline does not contain cannot be added to that episode: that is why the caching scene reads its "first lookup" word from the narration instead of a stored cue.
* **Side effect to expect.** Any change under `src/` makes every project's recorded render sources differ, so the caching episode's final video shows as out of date until it is rebuilt (its recorded sources are re-recorded by that rebuild, as for v5). Its recorded timing, mix, takes, video and cover are unchanged and still its current artifacts.
* **Rough previews.** A preview with a temporary voice is made in a *temporary restored copy* of the project, with a stand-in audio worker (macOS system voice, length-weighted word timing) and the real renderer, in draft mode (a draft can never be approved). A label band is burned into the copy that is delivered. The copy of the project is deleted afterwards, so the real project never holds takes from a stand-in voice.

## 2d. Reconciling later production work, the creative checkpoint and the animatic (22–24 October 2026)

Three episodes had been produced in isolated working copies after §2c: AI Maxxing 01 (tokens, published v3), AI Maxxing 02 (prompt injection, published v2) and Tech Under the Hood 01 (rotating ticket, an unpublished review draft). This section records what was only in those copies, what Studio now holds, and what was added.

**What was adopted (targeted, not a whole-checkout copy).** Scene types `rotating-ticket` and `prompt-injection` (+ the ticket's three real QR matrices), the series label and `openingUntilCue` options of the shared opening, the published v3 wording of `token-journey`, the cue rules for the new scenes, their schema/registry/catalogue entries, and tests. **Not adopted:** the copies' isolated render/still workers, which hard-code a browser path; Studio's own workers are used. The three project folders were copied (`cp -Rp`, checksums identical) into `projects/` and opened by the supported route; nothing was edited in SQLite. A fresh Studio render of each episode, after Studio re-recorded the render sources through a normal rebuild, was **byte-identical** to the earlier file (tokens v3, prompt-injection v2 and the ticket review v1); older renders stay as earlier builds. Those are *measured* facts about files. That the earlier files are the published/reviewed ones, and everything about publication, comes from the projects' own records and the author; Studio did not re-verify it and nothing was published, ticked or approved here.

**Gap found and closed: cue rules and the timeline-logic fingerprint.** The cue rules in `sceneSpecs.ts` are fingerprinted, so any new rule made a timed episode refuse to re-time. (1) An episode may now adopt the current logic when the *only* change is cue rules and re-resolving the current rules on its recorded timeline reproduces the recorded cues (`cueRulesPreserved`, `timelineLogicAdoptable`; tests in `tests/app/timeline-logic.test.ts`). (2) Rules for new document-driven scenes live in `src/library/dynamicCues.ts` (not fingerprinted; hashed into timing inputs), so adding a scene no longer touches the fingerprint.

**New scene `ticket-motion` (revision 2 of the ticket episode, a separate revision; `rotating-ticket` is untouched).** One pass assembles; a screenshot separates from the same object; the clock advances and the live code swaps behind a scan line while the copy stays frozen; the code travels as a data packet to a gate reader that compares it with an allowed time window; the old copy is rejected and the live pass accepted (X / check, retracting barrier); Pip notices, inspects and relaxes; a "static codes" limit card and the full-page takeaway close it. Helpers (`src/library/motion.ts`: windows, springs, anticipation, damped shake, curved paths, camera) are pure functions of time. It keeps the artwork, voice, typography, palette, stage strip and takeaway; the opening overlap is opt-in (`openingOverlap`), default unchanged.

**Creative checkpoint (planning workflow, no new schema).** The Script tab of the plan has a *Creative checkpoint* card that reads fields the plan already has: hook options are the `proposed-wording` claims `hook1…`, the exact takeaway is the claim `takeaway` (its sources, what it was assessed against, and its limit), facts are `fact` claims with sources and evidence, a claim `demand` records audience-interest evidence or says it is unverified, and the storyboard's `mechanism` names the visible demonstration. `app/shared/creative.ts` (pure, `tests/app/creative.test.ts`) turns that into **checks Studio runs** — at least three different hook options, each within 48 characters (4–8 words is advice), the chosen hook is one of them and the narration's first sentence says it, the takeaway cites plan sources, says what it rests on and states a limit, the narration ends on its key words (a word-match heuristic, labelled as one), every fact has a source and evidence, cited sources are marked checked (only the author can mark one), the series is spoken in the opening, a brief and a demonstration are recorded, demand is recorded, the animatic is current — and, separately, **guidance Studio does not check** (listening, full-speed phone-size playback, contact sheets, caption-safe visual review, the cover, audience evidence, source checking, author approval). The checks are advisory and block nothing; the only enforced rule is the episode's own (hook ≤ 48 characters).

**Five-second opening animatic.** A job `animatic.build` (`core/handlers.ts`, `core/animatic.ts`) draws the first 150 frames of the episode as it is now with the render engine on an *estimated clock* (word counts), silent, as its own artifact (kind `animatic`, subject `opening`). It is not a build: it changes no stage status, rebuild plan or approval (`tests/app/animatic-jobs.test.ts`). It is current only while the hook, script, scenes and render sources are what it was drawn from; changing only the hook makes it outdated and leaves narration, timing and mix fresh. The Script tab has the button and the player; the route is `POST /api/episodes/:id/animatic`, media at `/media/animatic/:id/opening.mp4`.

**Selective invalidation, observed live on the ticket project.** Saving revision 2 made exactly `take:b1` (hook-first line), `timing`, `mix:final` and `render:final` run; `b2`–`b5` were reused. After a later scene-only polish, the plan showed `render:final` alone. The voice for `b1` was the approved voice (a real run); timing source `qwen-aligned`.

## 2e. Presentation proofs and shot controls (24 October 2026)

The author approved a refinement of the visual rules (**Presentation flexibility**, `pip-brand-standards.md`): the chapter header and full stage strip appear where useful rather than on every body shot, close-ups and demonstrations may use more of the frame, and Pip may move, take part in a shot or leave it. Defaults for older episodes are unchanged. To test it, one coherent passage of the existing prompt-injection episode (s2 to s4, "It opens a shop page" to "the shop has hijacked your task") was drawn three ways, next to the current treatment as a baseline: **interface** (the shopping assistant fills the frame, the camera pushes into the planted instruction and pulls back to the changed recommendation), **investigation** (the page is an evidence exhibit below a trust boundary, the planted line is lifted out and enlarged, traced across the boundary and the consequence reconstructed; the full strip clears for the close-up and returns; Pip steps out and back in) and **mechanism** (the request becomes a task capsule on the agent's instruction path, the page feeds the agent, the planted line follows the same pipe and pushes the capsule onto the wrong lane; no chapter chrome). They are draft creative comparisons for the planning chat, not adopted defaults, not approved cuts and not a full-episode treatment.

**Reused, not rebuilt:** the render pipeline and `LibraryEpisode` (the captions, the PIP EXPLAINS header and the series label are drawn by it above every scene, in screen coordinates), `motion.ts` (springs, anticipation, paths, the camera), the Pip performer and its score (`move` tracks already let him step aside or leave), the recorded timing, the recorded final mix and the job service. **Added:**
- `motion.ts`: `camOn` (frame a rectangle), `camRect`, `rectCentre` and `camTrack` (a keyed camera: hold, ease, arrive; pure in time, so seeking is exact).
- `src/library/Shot.tsx`: `ShotLayer` (a clipped viewport over a transformed world, so a zoomed scene never enters the header or the caption band), `Spotlight` (evidence highlight), `irisClip`, `wipeClip` and `Masked`.
- `chapters.tsx`: `ChapterTag`, a compact current-chapter label for shots that need the frame. `ChapterHeader`, `StageStrip` and `FullPageTakeaway` are untouched.
- The scene `prompt-injection` takes an optional `params.treatment` (`interface`, `investigation`, `mechanism`). With no treatment it renders exactly as before; a treatment replaces it only inside the passage window and the baseline plays everywhere else. Extra passage cues are resolved in the scene from the recorded word times (`scenes/injection/passage.ts`), so no fingerprinted file, timing input or recorded timing changed.
- A job `proof.build` (`core/proof.ts`, `POST /api/episodes/:id/proof`, media at `/media/proof/:id/:artifactId.mp4`): draws a window of the episode from its recorded timing and final mix (the render worker's `frameRange`), as its own artifact. It never makes narration, timing or a mix, is not a build, moves no approval, and is current only while everything a final render would be made from is what it was drawn from. No UI was added.

**Measured** (`scripts/verify_injection_proofs.py`, `scripts/verify_injection_proofs_stills.ts`, tests; numbers in the delivery folder's `measurements.json`): each proof is 398 frames, 13.27 s, 1080 x 1920 H.264 + AAC, drawn in about 16 s; the four files are byte-identical across two independent runs; 12 frames of each treatment rendered in ascending and in a shuffled order are byte-identical; seeked frames in the file equal sequentially decoded frames; the audio is the same stream in all four proofs and correlates 0.99995 at zero lag with the same window of the recorded mix; the header, caption and note bands match the baseline in every treatment (PSNR 42 to 61 dB); the document restored to the baseline rebuilds to a final video **byte-identical** to the published v2 file. **Not measured here:** how the proofs look, read or feel at full speed on a phone, and how the narration sounds; those belong to the author. The proofs work only on this passage, with its fixed words and recorded timing, and cover s2 to s4 of the episode.

## 3. A rule this work had to respect

A project records the **render sources** (everything under `src/`, the package files, `src/theme.ts`, the assets) when it is set up. A video, a
cover or a check refuses to run when the working copy of those files differs from what was recorded. So this work changes **nothing under
`src/`**: the cover hides captions by drawing from the recorded timeline with its captions removed, not with a new flag in the composition.
Changing `src/` for any reason makes every existing project refuse to render or draw covers until its sources are recorded again.

## 4. The caching episode's authoring context

**Finding.** `why-caching-is-faster` was made through the project and job APIs: it has an episode, takes, a mix, a timeline and a video, but **no planning
document**, so the Idea, Research, Script and Storyboard steps have nothing to open (the list says "Imported from files; it has no planning
document"). The planning document is a row in the `plans` table whose id **equals the episode id**; that is the whole connection. The existing
*New episode* path cannot make it: it derives a fresh id and refuses ids that are already episodes, so it cannot be used without making a second
episode.

**Does it need a migration? No.** No schema change (the project stays at schema version 4) and no stored row is rewritten. Linking *adds* one
row to `plans` and one to `plan_revisions`. Nothing a build depends on is touched, because a plan is not part of a build's inputs.

**The supported way, added in this work:** *Connect planning notes…* on the episode list (or `POST /api/episodes/<id>/link-plan`, function
`linkPlanToEpisode`). It writes the brief and storyboard **from what the episode already holds** and says so in the plan's notes: title,
learning objective, sources, and one storyboard scene per episode scene (type, the segments it covers, its parameters). It invents no audience
(you may type one), no claims, no intentions. For an episode that has an opening hook it marks the plan as a Pip Explains episode, so the hook is
then required; for an older episode it does not. It refuses when a plan already exists or the episode does not exist.

**Rehearsed on a restored copy of the real caching project, not on the project itself:**

* Backup of the project made through its running app's *Back up now* (verified, 135 blobs): `projects/caching-episode-backups/backup-2026-10-19T19-13-42`.
* Restored to a temporary folder (no missing blobs, no interrupted jobs) and linked. Compared before and after: episode sequence number and document hash, number of revisions, artifacts (and therefore takes), jobs, every current output (kind, subject, artifact id, file hash), the freshness report, and the components: **all unchanged**. Added: one `plans` row and one `plan_revisions` row. The linked plan had the title, the objective, the 2 sources and one storyboard scene (`cache-journey`, 9 segments); the rebuild planner reported no blockers; the existing final video stayed `fresh`.
* A real cover job (the real Remotion still) was run on the copy: 2.1 s, `fresh`, 1080 x 1920, **byte-identical** to `out/caching-v2/opening-20.png` (SHA-256 `fa13e579...c1740d`) and, against the author's reference cover (frame 0.667 s of the MP4), PSNR 39.5 dB and SSIM 0.992, the difference being the video's lossy compression.

**Not applied to the real project, and why.** The author's app on that project (process started before this work, port 4319) holds the project's lock and runs the earlier code, which has no link route. Stopping or restarting someone else's app is not this work's to do. To connect it: close that app, start the current code with `./studio-app open projects/caching-episode`, and press *Connect planning notes…* on its episode. The backup above is the way back (restore it into an empty folder).

## 5. What was verified, and with what

Measured in this session; "real" and "fake" are exact.

**Automated tests** (new or extended): `tests/app/cover-jobs.test.ts` (8) on the job service with fake audio, render and still workers: an older episode is built, approved and exported exactly as before; a video without the opening has no cover and cannot be given one; a hook-only edit leaves narration, timing and mix fresh and makes only the video stale (the rebuild plan runs `render:final` alone, the same take, timing and mix artifacts stay current); the cover job's spec is the same timeline with no captions at frame 20 and the hook; export without a cover is refused and with one includes it byte for byte; a failing still worker leaves no cover; a reopened project still has cover, video and their match. `tests/app/opening-workflow.test.ts` (10) on a real server: new-episode defaults, hook blocker, hook validation (49 characters and blank refused), the hook survives applying a storyboard (checked by removing the carry: it fails), chime exactly once (repeat, duplicates reduced, removal), older episodes unchanged, linking changes nothing else. `tests/benchmark-record.test.ts` now also pins the caching video and cover by SHA-256.

**One disposable project through the real page** (`node scripts/verify_next_episode.ts`; evidence in `docs/studio/pip-opening-evidence/`):

| Real | Fake |
|---|---|
| the page and server, project store, job runner; timeline logic (Python); the audio mix with the chime (Python and ffmpeg); the Remotion **render**; the Remotion **still** that draws the cover; dependency hashes, freshness, export and checksums | the voice model (a stand-in audio worker writes deterministic speech-like audio) and the forced aligner (timing is the labelled estimate); the sign-offs for the export step, simulated in this disposable project only |

Result: every assertion passed. In order: the new episode had bundled fonts, the chime once, the quiet mix levels and no hook; the build was blocked until the hook was set; a 49-character hook was refused with the 48-character message; the hook was saved on the Script step and the title stayed separate; applying the storyboard kept the hook; the Scenes step and the Script step showed the shared opening (banner and hook) in the preview; the first final video took 22.4 s (take, timing, mix, render) and its mix contained exactly one accent, the chime at 0.12 s; the cover was drawn from that video (1080 x 1920, downloaded byte for byte, attachment header); the cover against frame 20 of the video: **PSNR 39.3 dB, SSIM 0.990 above the caption band**, 16.8 dB and 0.957 over the whole frame because that video's frame 20 already carries a caption and the cover deliberately has none; a hook-only edit made the cover "Out of date", the video "older than your edits", download withdrawn, and the plan ran only `render:final`; the rebuild took 19.2 s and reused the same take, timing and mix artifacts (narration jobs ever run: 1, timing 1, mix 1, render 2); a new cover with a different hash and hook was made for the new video, and the first cover stayed outdated with the first video; the export package contained the cover (SHA-256 equal to the cover) and verified; after a restart the hook, the chime ("On, once") and the cover (same cover, same video) were all still there; a second and third request to add the chime changed nothing. The browser reported no console errors; the one failed request (HTTP 422) is the deliberately broken research paste in the shared scenario.

**Against the author's reference:** see section 4 (the app's cover is byte-identical to the earlier opening frame of the caching video and within PSNR 39.5 dB / SSIM 0.992 of the author's cover).

Not examined: whether the narration sounds natural or the words are right (the audio here is a stand-in); how the cover looks cropped in an uploader's profile grid; real forced alignment; the real voice model; any episode other than the disposable one and the rehearsal copy.

## 6. Limitations

* The caching project is **not yet connected** to its planning document (see 4); until its app is restarted on this code its Idea, Research, Script and Storyboard steps stay unavailable.
* The cover frame is fixed at 0.667 s. If an episode's first caption already appears before then, the video's own frame carries that caption and the cover (which has none) differs from it there, by design.
* A cover is drawn only from the recorded sources of its video. If anything under `src/` has changed since the video was made, the cover is refused with the list of differences rather than drawn from different code.
* The hook preview and the composition preview run on an **estimated** clock; the finished video's opening uses its recorded timing.
* Fonts: a cover of a `pip-paper-bundled` episode needs the bundled fonts intact; the job refuses otherwise.
* The cover is not attached to a post automatically, and its fit in an uploader's crop is the author's to check.
* The chime can be added or removed for any episode (an explicit action that makes its mix and video out of date); only new Pip Explains episodes get it automatically.
* Approval and export remain the author's: the app records nothing as approved by this work.

## 7. Short walkthrough

1. **Episodes** → *New episode*. Give it a descriptive title, who it is for and what the viewer should understand.
2. **Research** and **Script**: paste what you have (the app only reads it). After the script is accepted, type the **hook** (up to 48 characters) in the *Opening hook* card and press *Save hook*. Watch the opening in the little player. The chime is already on, once.
3. **Storyboard** → apply it. **Scenes**: the hook card is on top; adjust scenes; the composition preview shows the scenes on an estimated clock.
4. **Voice** (as usual), then **Review** → *Make the final video…*. The plan lists what will run.
5. On **Review**, the **Cover image** card beside the video: *Make the cover*, look at it, *Download cover*.
6. If you change the hook later, the video and cover say *out of date*; narration, timing and audio are reused, so *Make the final video…* only redraws the video; then *Make the cover* again.
7. After you approve the video, *Export the approved video* includes the matching cover.
