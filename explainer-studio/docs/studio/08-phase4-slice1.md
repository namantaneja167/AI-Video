# Phase 4, slice 1: editable preview

Scope: the first working editor screen on a persistent demo workspace. It reads and saves episode edits and shows the last build. It starts no jobs, generates nothing, renders nothing and does not touch real projects (`init`/`adopt` is still paused). The jobs tray, the revisions menu, rebuilding and notes belong to later slices. Stopped here for your review.

## How to open it

From `explainer-studio/`:

```
./studio-app                  # starts the app on the demo workspace and opens the browser (Ctrl+C stops it)
./studio-app --no-open        # prints the sign-in link instead of opening it
./studio-app reset-demo --yes # explicit reset: the old workspace is renamed, never deleted
```

* **Demo workspace:** `explainer-studio/demo-workspace/pip-context-window/` (a real project store: SQLite plus blobs). `demo-workspace/README.txt` says the same. It is git-ignored.
* It was created once from the context-window revision 2 outputs and the saved narration takes (no model ran). It is never overwritten on restart. Your edits, the selected segment and the panel sizes are kept in it. Only `reset-demo --yes` replaces it, and that moves the old one to `pip-context-window.replaced-<time>` first.
* The launcher accepts only `--no-open`, `--port N`, `--rebuild` and `reset-demo --yes`. `init`, `adopt` and any path are refused (exit code 2).
* The app listens on `127.0.0.1` only, default port 4317. The first link carries a token that sets a cookie; the token is kept in `.studio/app-token` in the workspace, so the cookie survives restarts.

## Status: three separate states

| Item | Built | Technically passing (measured) | Human-approved |
|---|---|---|---|
| Persistent demo workspace, seeded from revision 2 | yes | seeded workspace reports narration, timing, final mix and final render all fresh; the launcher opened it with no console errors | no |
| Editor: outline, real Remotion Player with the saved audio, segment inspector, read-only timeline, collapsible panels, stepper, rail | yes | 1280 x 800 layout, panel collapse, persistence (section 4) | no: layout and look are yours to judge against the mockups |
| Truthful preview (section 2) | yes | unit and browser tests (section 4) | no |
| Reliable saving and recovery (section 3) | yes | unit, server and browser tests including a killed server | no |
| Honest costs (section 5) | yes | unit and browser tests | no |
| Phase 4 slice 1 as a whole | yes | see section 4 | **no: awaiting your review** |

## 1. What was built

| Area | Where |
|---|---|
| Launcher, server, demo seeding, UI build | `studio-app`, `app/main.ts`, `app/server.ts`, `app/demo.ts`, `app/build.ts` |
| Pure logic shared by the browser and the tests | `app/shared/compare.ts` (preview truth), `costs.ts`, `edit.ts`, `autosave.ts`; `src/library/emphasis.ts` (extracted from `core/timeline.ts`, same behaviour) |
| Browser UI | `app/ui/` (`App`, `Preview`, `Outline`, `Inspector`, `Timeline`, `Stale`, `Chrome`, `styles.css`) |
| Tests | `tests/app/` (`logic`, `autosave`, `server`, `browser.slow`, helpers) |
| Dependency | `esbuild` 0.28.1 declared as a pinned devDependency (the version `@remotion/bundler` already used; it builds the page). No other package was added. |

The only existing code changed is `core/timeline.ts` (it now calls the extracted emphasis mapping; the existing tests for it pass).

## 2. What the preview shows, and when it says so

The preview is the real Remotion Player running the real `studio-episode` composition on **the last build**: the scene settings, the timeline and the saved mix audio. It never mixes your current edits into that.

* A build label names what is shown (`Build r1 · date · imported`); hovering gives the workspace revision and, for this demo, that the build was imported from the revision 2 outputs.
* If anything differs from the build, a banner says "This preview is the last build, not your edits" and lists what differs in plain sentences: spoken text changed (the audio is the narration built for the earlier words), caption text changed (the captions are the built ones), scene settings changed.
* **Live emphasis** is the one exception: emphasis edits are drawn live only where the caption words are the built words. If a segment's words changed, its emphasis edit is explained and not drawn.
* The audio chip says whether the audio and the timeline were built from the same words.
* The list of what is out of date and what rebuilding costs comes from the saved version (the real freshness calculation), so while an edit is unsaved the popover says that instead of guessing.

## 3. Saving and recovery

* **Saved is shown only after the commit.** The server answers after the store's transaction has committed (WAL, `synchronous = FULL`). The save states are Saved, Unsaved edits, Saving, Not saved (with Retry), Can't save yet (document invalid, with the reason), and Newer version exists.
* **Edits are never dropped.** Every edit is first written to a local draft in the browser, then saved (about 0.5 s after typing stops; Cmd+S saves at once). A failed save keeps the edit on screen and in the draft, shows the reason and offers Retry; a later edit also retries. After a reload the draft is put back, on the same saved version.
* **Conflicts.** Each save names the saved version it was based on. If another tab or session saved a newer version, the save is refused (nothing is overwritten) and you choose: keep my edits and save on top, or use the saved version. A tab with no unsaved edits follows other tabs' saves silently.
* **Server stops.** A restart or crash leaves everything that was committed. Edits made while it is down stay in the page, the lost connection is announced, and when the server returns the page says it was restarted and saves what it held.
* **Emphasis keeps documents valid.** Changing a segment's words moves each emphasis range to the same phrase, or drops it with a notice; this is why an edit cannot silently emphasise other words.

**Recovery limits.**

* Committed data lives in the workspace. Unsaved edits live only in this browser's local storage for this address (host and port). Clearing site data, another browser, another port or a private window loses an unsaved draft but not saved data.
* The draft is one per episode per browser profile. Two windows of the same browser with unsaved edits to the same episode overwrite each other's draft (their saves are still protected by the conflict check).
* A draft made on an older saved version is not applied silently: you are asked.
* Closing the tab with unsaved edits shows the browser's leave-page prompt.
* One server process per workspace (the store's lock refuses a second one). There is no multi-user locking.
* The token is stored as a file in the workspace and a one-year cookie; there is no TLS. This is a local tool.

## 4. Measurements

All from this session, on a 16 GB MacBook, headless Chrome from Remotion. Numbers below are measured; whether anything looks right is not.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run test:ts` | 393 tests, 393 pass, 0 fail, 0 skipped (31 are new: 10 comparison, edit and cost; 9 autosave; 12 server) |
| `npm run test:py` | 30 tests OK |
| `npm run test:slow` | 17 tests, 17 pass (11 are the new browser tests) |
| Layout at 1280 x 800 | page scroll size equals the window (no page scrollbars); outline, preview, inspector, timeline, top bar and stepper all inside the window; phone preview at least 300 px tall (asserted; it shrinks while the banner is shown) |
| Panel collapse | preview area 580 px wide with both panels open, 876 px with the inspector collapsed, 1112 px with both collapsed; collapsed state and timeline height survive a reload; Home or double-click resets the timeline |
| Edit marks | badges and the top chip turned amber 0 to 5 ms after the edit was handled (limit in the test: 1 s); saved (committed) about 0.6 s after the last key |
| Preview versus a rendered frame | structural similarity (SSIM, 1 is identical) of the Player and a rendered still of the same frame, at 626 x 1113: 0.968, 0.967, 0.965 at frames 72, 285 and 510. The Player at frame 72 against the render of the frame half a second later scores 0.954 and three seconds later 0.922. So same-frame pairs score highest, but the margin from a nearby frame is small: this check catches wrong or missing content, not fine differences. |
| Persistence | reload keeps the edit, the selected segment, collapsed panels, timeline height; a server restart keeps edits and preferences; a killed server (SIGKILL) kept what was saved, the held edit was saved after the restart |
| Failure paths | a commit failure injected inside the transaction left the store unchanged and showed Not saved; reload during it restored the edit; Retry saved it. Two deliberate conflicts (use saved, keep mine) behaved as described |
| Keyboard | Space plays and pauses; `]` and `[` move between segments and seek; Tab reaches the segment list, play, previous and next, the scrubber and all three fields; Cmd+S saves at once. Add-note belongs to a later slice |
| App starts no jobs | the job count was unchanged by saving |
| Console and requests | no console errors; the only refused requests were the four provoked ones (two injected commit failures, two conflicts) |
| Protected files | nothing under `prototypes/`, `reference/pip-voice/approved-v1/`, `episodes/`, `src/art` changed (Git status) |

## 5. Costs

Estimates come only from durations measured in earlier real runs of this sample, stored with their source in `measured-runs.json` in the workspace; the popover labels them "estimate" and shows "Not measured" where there is no run. Totals say when they are incomplete.

For this sample the measured runs are: narration b1 31.2 s and b2 30.2 s (including loading the voice model); timing 20 s and 2.3 s (the second run was faster, likely because the model was already warm; the estimate is shown as a range); final mix 0.9 s and 1.1 s; final video 27.5 s and 27.5 s. Draft mix and draft video were never built and have no measurement. Revision 2's narration was imported, so it contributes no narration time.

## 6. What needs your eyes

* Whether the layout, labels and wording match the approved mockups and read well (screenshots in [slice1-screenshots/](slice1-screenshots/): the demo workspace as opened, an edited and stale state, the explanation, a failed save, collapsed panels, a conflict, and the server down).
* Whether the preview plays the way you expect with sound (the tests do not judge the audio).
* Whether the wording of the stale explanations is clear.

The screenshots 02 to 07 were taken from temporary test workspaces (labelled "Test workspace"), not from the persistent demo workspace, which stays unedited until you edit it.

## 7. Limits

* The screen edits segment text, spoken text, emphasis and pause after. Scenes, layouts, beats, notes and sources are shown, not edited. A pause edit is saved but not shown anywhere in the preview.
* The timeline is read-only and lists scenes, segments, caption phrases and emphasis; there are no sound or mouth lanes yet.
* Stepper stages other than Script are shown as unavailable; Voice and Render show their saved state read-only. The rail items other than Episodes are unavailable.
* Rebuilding, the jobs tray and revisions are not in this slice, so nothing here can make the preview catch up with your edits.
* The Remotion licence notice is not acknowledged on your behalf; the Player may log it to the browser console.
* Playing with sound needs a click or key press first (browser autoplay rules).
* The parity check is at one size, three frames, with a small margin over a nearby frame (section 4).
* Costs rely on two runs of one sample; they are estimates of this machine on that day.
