# Phase 5 acceptance: research, script, storyboard, manual ChatGPT import

**Status: implemented; automated checks passing; user review pending.** A verification round (section 10) followed the first report: the intermittent restart-test failure was traced and fixed, the Phase 5 browser tests joined the supported test command, import atomicity and recovery got their own tests, and the storyboard's states were separated. Phase 4 is recorded the same way (implemented, automated checks passing, user review pending; its documented limits stand, see [09](09-phase4-slice2.md)). Phase 6 has not been started.

This document separates what was **measured** (commands and counts that ran in this session) from what is **for you to judge** (whether the screens read well, whether the briefs work in a real ChatGPT conversation, whether the sentence splitting suits your scripts). Nothing here says that narration sounds natural, that any text is right, or that any video looks good: no narration was generated and nothing was rendered.

## 1. What to open

The app is running on the demo workspace with the Phase 5 code:

```
http://127.0.0.1:4317/?token=4b5f61538b7fa577e11ff38b0da07792693ac2839177f244
```

(`./studio-app` opens the same workspace again after a stop.) With two episodes in the workspace the landing page is the **Episodes** list; with exactly one episode and no drafts it still opens that episode's editor, as before.

* **What is a token?** (`what-is-a-token`) is a new episode made through the real UI by `scripts/phase5_demo_ui.ts`: a draft with a brief, research (3 sources, 4 claims), an accepted script (5 segments) and a storyboard (3 planned scenes). Open it from the list: **Open plan** (Idea, Research, Script, Storyboard in the stepper) or **Open script editor**.
* **Context window explainer** (`context-window`) is the baseline and is untouched (section 6).

Try it yourself: **New episode**, then Research, **Copy brief**, paste into ChatGPT in your own browser, bring the answer back with **Import a ChatGPT answer…** (paste, or open a saved `.json`, `.md` or `.txt` file).

## 2. What was built

| Part | Where | Notes |
|---|---|---|
| Episode drafts | `app/planning.ts`, `app/ui/Episodes.tsx` | Title, audience, objective, approximate length. Stored in the project database; persistent. A draft has no episode document until a script is accepted. |
| Planning document | `app/shared/plan.ts`, tables `plans`, `plan_revisions` | Brief, sources, claims, storyboard plan. **Not part of the episode document** (section 5). Every save is a numbered version; restore creates a new version. |
| Research records | `app/ui/Research.tsx` | Source: title, link, publisher, publication date (when known), note. Claim: text, **fact / assumption / proposed wording**, sources it rests on, evidence, caveat. A saved link is labelled "Link recorded · not fetched · not verified". "Checked" is set only by your own click. Warnings: fact without a source, claim resting only on unchecked sources. |
| Handoff briefs | `app/shared/handoff.ts`, `app/ui/Import.tsx` (`Handoff`) | Copyable text for Research, Script and Storyboard, containing the episode brief, the exact JSON format and the rules. It only writes text. |
| Import | `app/shared/packet.ts`, `app/planning.ts`, `app/ui/Import.tsx` | JSON, Markdown with one fenced JSON block, or a plain script; by paste or by opening a file. Strict validation with exact locations. |
| Review before accepting | `app/shared/importing.ts`, `app/ui/Import.tsx` | Items arrive **Proposed**. Per-item checkboxes for sources and claims, an editable row list for a script, a read-only list for a storyboard, a list of what a replacement would change, and an explicit confirmation before anything is replaced. |
| Storyboard | `app/shared/storyboard.ts`, `app/ui/Storyboard.tsx` | Narration lines to planned scenes, with intention, what is shown, Pip's actions, and a scene type. Every scene is reported with what stops it. |
| Episode creation | `core/episodes.ts` `createEpisode` | A first accepted script creates the episode through the same store as every other episode: one transaction, a permanent revision, the `episode.json` file written after the commit. |

### 2.1 The import format

A packet is one JSON object. Unknown fields are refused, not ignored.

```json
{
  "studioPacket": 1,
  "kind": "research",
  "sources": [{"title": "…", "url": "https://…", "publisher": "…", "published": "2024-05-14", "note": "…"}],
  "claims":  [{"text": "…", "kind": "fact", "sources": [0], "evidence": "…", "caveat": "…"}],
  "script":  {"segments": [{"text": "…", "speech": "…", "pauseAfter": 0.4}]},
  "storyboard": {"scenes": [{"segments": [1, 2], "sceneType": "cards", "intention": "…", "mechanism": "…", "pip": ["…"], "params": {"title": "…", "cards": [{"heading": "…", "lines": [{"text": "…"}]}]}}]}
}
```

* `claims[].sources` are positions in the packet's own `sources` (from 0) or ids of sources already in the plan. `storyboard…segments` are script line numbers (from 1), of the script in the same packet or the accepted one.
* A **plain script** is split by paragraph, then by sentence (decimals, `e.g.`, `Dr.` and similar do not split; fragments under three words join their neighbour; headings, bracketed directions and `Narrator:` labels are left out and reported). Rows over 40 words are flagged "long". It is a heuristic: you edit, join, split, add and remove rows before accepting.
* An unknown `sceneType` is accepted as data and flagged later, because it is the author's plan; it is not guessed or mapped. `params` is optional; when present for a scene type this app has, it is checked against that type's own schema at import, with the exact path, and refused otherwise.

### 2.2 The storyboard check

A planned scene is in exactly one of four states. The state comes from the scene type's own schema and cue rules (`SceneSchemaV2`, `SCENE_CUES`), not from a list kept by hand; scene types themselves are listed in `SCENE_TYPES` and kept in step with the episode schema by a test.

| State | Meaning | How it changes |
|---|---|---|
| **Ready** | A scene type this app has, parameters that pass that type's schema, the narration its cue words need, every line it names present in the script | Nothing more is needed to put it in an episode (section 12). |
| **Incomplete** | A scene type this app has, but its parameters are missing or invalid, or the planned narration lacks the words the scene times itself on | Add parameters (the **Parameters** field when editing a scene, or `params` in an import) or fix the narration. It can then become ready. |
| **Custom** | A scene nothing existing does | A developer implements and registers it; until then it stays here. |
| **Unsupported type** | Not a scene type this app has, or a test fixture | Choose a listed type, or mark the scene custom. |

Scene types by how reusable they are: `cards`, `kpi-mismatch` and `tables-lab` are data-driven and drawn in the dark (legacy) look (there is no generic Pip warm-paper scene yet); `context-window` and `pip-scene-10x` are built for one piece of narration and fit another only when its cue words match.

The storyboard as a whole is **producible** only when every planned scene is ready and every narration line is in a scene. Otherwise the screen says "Not every planned scene is ready yet", with counts per state and the reason per scene; this is a statement about the current plan, not about what can ever be produced. The rebuild plan carries the same reasons as blockers, so a rebuild is refused with 422 before any worker is asked to do anything; when everything is ready it still says that the planned scenes have not been put into the episode (section 12).

Because the episode schema requires at least one scene, accepting a script creates the episode with one **stand-in scene** (`storyboard-pending`, type `cards`). The editor labels it "Stand-in (scenes not made yet)", the storyboard screen says it is not part of the plan, and a rebuild is blocked while it is the only scene.

## 3. Acceptance, item by item

Criteria from [05 Phase 5](05-implementation-plan.md#phase-5--research-script-storyboard-chatgpt-import-m) and from your request.

| Criterion | Evidence (measured) |
|---|---|
| Invalid JSON shows the exact path and reason and imports nothing | `tests/app/packet.test.ts` (syntax errors with line and column; schema errors with the field path, e.g. `claims[0].kind` must be one of "fact", "assumption", "proposed-wording", but it is "rumor"; unknown fields; bad references; markdown line numbers counted in the pasted text). `tests/app/planning.test.ts`: the rejected paste leaves the `imports` table and the plan unchanged. Browser: the broken paste shows the path and "Nothing was imported" (`docs/studio/phase5-evidence/demo-3-invalid-paste.png`), and the page confirms zero imports stored. |
| A plain script splits into segments the author can adjust before accepting | `packet.test.ts` (splitter and row operations). Browser test and demonstration: a script is pasted, a row is edited, joined with the next and split again, and the accepted script equals exactly what was on screen (compared row by row). |
| Imported items stay Proposed until approved; provenance (source, date, hash) is stored | `planning.test.ts`: after a valid import the plan, episode list and revisions are unchanged and the import reads `proposed`; the original content is stored verbatim with its SHA-256. Accepted sources, claims and scenes carry `{importId, sha256, at, source}`; the episode's first revision is labelled `Imported from pasted text (#2, 26e8151e91c9)` and History shows it. |
| No network request is made during import, checked with networking blocked | `planning.test.ts`: while `fetch`, socket connect, DNS lookup and `http`/`https` request/get are replaced by functions that record and throw, a draft is created, a packet is submitted and accepted; zero attempts were recorded. A source scan of the planning and import modules finds no network APIs (the planner's one `EventSource` is pinned to this app's own `/api/events`). Browser test and demonstration: the page's resource list contains nothing outside the app's own origin. *This is a stubbed block inside the test process plus a source scan, not an operating-system firewall.* |
| Embedded instructions are data | `packet.test.ts`: instruction-like text is stored verbatim as a claim, a script line and as a plain script; a packet that adds its own fields (`onAccept`, `command`) is refused. The UI shows imported text as text. |
| Preview what will change; no silent overwrite | `importing.test.ts`, `planning.test.ts`, browser test: replacing a script lists changed, new and removed lines and needs an explicit confirmation (the accept button is disabled until then); a stale plan or episode sequence refuses the acceptance with 409 and changes nothing; an import already accepted or rejected cannot be accepted. |
| Accept through the existing revision and save path, with conflict protection | `planning.test.ts`: a replacement is one `saveEpisode(baseSeq)` with a `script-import` revision; the earlier script is recovered with the existing History restore (3 revisions: create, script-import, restore); ordinary edits and the stale-edit 409 still work on the planned episode. |
| Atomic | `planning.test.ts`: a fault injected before commit during acceptance leaves the plan, the episode table, the `episode.json` file and the import's state exactly as they were; the same request succeeds once the fault is removed. Section 9 adds rejection, abandonment, restart and concurrency. |
| Research-only changes do not regenerate narration or video | `planning.test.ts`: accepting more research leaves the episode's sequence and hash, its op count, the status report and the rebuild plan steps identical. The plan lives outside the episode document, so nothing that is hashed can change. |
| Dependency and freshness | A script replacement changes the episode like any edit, so the existing freshness logic applies. This was **not** exercised against built narration for a planned episode, because none has been built (no models were run); the existing freshness behaviour of the baseline is covered by the earlier phases' tests. |
| Storyboard states | `importing.test.ts`: all four states side by side with their reasons; valid parameters make a scene ready and a whole storyboard producible; invalid parameters name the field; an own-content scene is ready only with valid parameters and matching cue words; parameters in a pasted packet are checked with the exact path. Browser: a scene moves from incomplete to ready when parameters that fit are typed in, and an invalid set is refused and not saved. |
| Existing episodes preserved | `planning.test.ts` and the demonstration: see section 6. Migration test: a database made at schema version 2 gains the planning tables on open, keeps its episodes, and a backup copy is taken first. |

## 4. Commands and results (this session)

Final runs, on the code as it stands, through the supported commands:

| Command | Result |
|---|---|
| `npm run typecheck` | no errors |
| `npm run test:ts` (all `tests/**/*.test.ts`) | **528 tests, 528 pass, 0 fail**, 96 suites, 0 skipped. Run three times in a row on the final code with the same result. |
| `npm run test:slow` (`tests/prototype.test.ts`, `tests/library/render.slow.test.ts`, `tests/app/browser.slow.test.ts`, `tests/app/rebuild.slow.test.ts`, `tests/app/planner.slow.test.ts`; includes real Remotion renders) | **38 tests, 38 pass, 0 fail**, 6 suites (13 browser, 12 rebuild, 7 Phase 5 browser, the render and prototype parity tests). An earlier start of this command was stopped by me when I changed code under it, and was discarded; the result above is from a complete run started afterwards with no source edits during it. |
| `npm run test:py` | **Not re-run** in this phase: no Python, worker or pipeline file changed. |

New or changed test files in the verification round: `tests/app/shutdown.test.ts` (5), `tests/app/import-recovery.test.ts` (9), `tests/app/render-drift.test.ts` (2), `tests/app/importing.test.ts` (30, was 24), `tests/app/planner.slow.test.ts` (7, was 5). Earlier in the phase: `packet.test.ts` (23), `planning.test.ts` (20).

Before the round, no full run had been completely green: one run failed on a new test of mine (since fixed), one on the restart test (section 10).

## 5. Where the data lives, and why

The episode schema is in `src/`, which is hashed into the demo's recorded render sources; changing it would mark the demo's final video as out of date. So planning data is **not** stored in the episode document. It is in three tables added by a forward-only migration (schema version 3, applied with the usual backup first): `plans` (current document, sequence number), `plan_revisions` (every version) and `imports` (every accepted-or-pending import: when, how, file name, SHA-256, the original content, the parsed proposal, state, outcome). A rejected paste leaves no record.

Accepting an import writes the plan, the episode (create or replace) and the import's outcome in **one transaction**; the `episode.json` file is written after it commits, by the existing projection code.

## 6. The demonstration, and the baseline

`node scripts/phase5_demo_ui.ts` drove a headless Chrome against the running app on the demo workspace: Episodes list, **New episode**, copy of the research brief, a deliberately broken paste, the corrected paste, accept; a plain script pasted, a row edited, two rows joined and one split, accept; a storyboard pasted, accept. Observations are in `docs/studio/phase5-evidence/demo-run.json`; screenshots `demo-1` to `demo-12` are beside it.

| Measured, read from the database after the run | Before (Phase 4 state) | After |
|---|---|---|
| Schema version | 2 | 3 (migrated on start) |
| `context-window` sequence and document hash | 15, `59396c69a98c…` | 15, `59396c69a98c…` |
| `context-window` revisions | 6 | 6 |
| Jobs / artifacts | 16 / 16 | 16 / 16 |
| `context-window` status report | not re-read before the run (the earlier phase recorded it fresh) | build `b11-12-13`; both takes, timing, final mix and final render `fresh` in the status report. The rebuild plan now schedules the final render because `package.json` changed (section 11). |
| `what-is-a-token` | not present | episode seq 16, 1 revision (`create`); plan version 4; 3 imports, all accepted; `episode.json` written |
| Rebuild plan of `what-is-a-token` | n/a | blockers (stand-in scene; storyboard 0 of 3 planned scenes ready), start refused with 422, jobs still 16. Its three scenes read: cards incomplete, custom, context-window incomplete. |
| Page requests outside the app, console errors | n/a | 0, 0 (one 422 response: the deliberate broken paste) |

The sources in the demonstration episode are the author's own outline, the existing episode in this workspace, and one `example.org` link that the note calls a placeholder. Nothing was invented as a citation, no source is marked checked, and the "fact" claim that rests on the placeholder says so in its caveat.

## 7. For you to judge (not measured)

* Whether the screens and wording are clear, and whether the amount of confirmation feels right.
* Whether the three briefs get good answers from ChatGPT. They have not been tried against ChatGPT (the app contacts nothing); the example JSON inside each brief is tested to be a valid packet.
* Whether the sentence splitter suits your scripts (it was tested on English prose of the kind in the tests, not on your real scripts).
* Whether the storyboard fields (intention, what is shown, Pip's actions) are the right ones.

## 8. Limits

1. **Existing episodes without a planning document** (the baseline) have no import or research screens. There is no "add planning to this episode".
2. A new script can replace an episode's script only while the episode still has just the stand-in scene (no scenes, beats or markers tied to its lines). A script import over a real episode is refused with the reason; editing text goes through the editor. Segment ids are kept by position and a segment whose text is unchanged keeps its captions, emphasis and pause. Review notes anchored to a removed line stay, without the anchor.
3. **Nothing builds scenes from the storyboard yet.** A ready scene can be converted to an episode scene (section 12), but no screen or request applies it, and the episode keeps its stand-in scene. Parameters are typed as JSON; there is no per-type form. Pip actions and "what is shown" are notes, not instructions any later step can execute.
4. Research and storyboard edits are explicit saves per card, not autosave. A second tab's changes arrive by the live event; a stale save is refused.
5. The plan's title and objective are copied into the episode when the script is accepted; editing them in the brief later does not change the episode.
6. Script provenance is recorded on the plan and in the revision label, not per segment; later edits in the editor are ordinary edits.
7. Limits: 400,000 characters per import, 200 script segments, 100 planned scenes, 200 sources, 400 claims.
8. The offline check is a stub inside the test process plus a source scan (section 3). The briefs and splitter assume English.
9. The plan keeps a version for every save, with no merging of rapid saves.
10. Voice, Scenes, Review, Render and Export remain unavailable stages; for a never-built episode the stepper now says "not built" instead of "out of date" for Voice, and the outline no longer shows an "as built" chip when nothing was built (both small changes to the Phase 4 screens).

## 9. Import atomicity and recovery

`tests/app/import-recovery.test.ts` (9 tests, all pass) runs on a real server and store:

| Claim | What is checked |
|---|---|
| A rejected import changes nothing | After reject: the plan row and its history, the episode row, its revisions and ops, the `episode.json` bytes and every earlier import's record are identical to before; only the rejected import's own row changes to `rejected`, keeping its text. Rejecting twice, or accepting after rejecting, is refused (409). |
| A cancelled ("decide later") import changes nothing | Opened and closed, then the server is restarted: everything identical, the proposal still `proposed` with the same hash and text, and accepting it later records the original hash in the revision label. In the browser, "Decide later" and "Reject this import" are clicked and the episode, history and plan are compared before and after through the API. |
| A refused or failed acceptance leaves the proposal waiting | Missing confirmation (422) and an empty script (422): nothing recorded. The injected-fault test from section 3 covers a failure inside the transaction. |
| Accepted imports survive a restart | Plan, plan history, provenance on sources, claims and scenes, every import record with its outcome, the episode, its revisions and its file are identical after a restart, and the API payload is deeply equal. |
| A crash between commit and file write is repaired | The episode file is deleted (as if the server died after committing); the next start recreates it byte for byte. |
| Concurrent edits cannot silently overwrite | Two accepts of one proposal at once: exactly one applies (200 and 409, one `create` revision, one op). An accept and a plan edit from the same version: one wins and the other gets 409, and nothing is lost either way. A stale editor tab cannot overwrite an accepted script (409), and an accept cannot overwrite a newer editor save (409, proposal still waiting). An accept and an editor save started together: exactly one applies, and the document is one of the two, never a mixture. |

What this does not show: a hard kill of the process in the middle of the transaction (SQLite's atomic commit is relied on, and the injected-fault test covers the rollback path, not a power cut).

## 10. Verification round: the restart-test failure

The failure was `ECONNRESET` in "committed edits and preferences survive a restart of the server", once in a full run (`fetch failed`, `read ECONNRESET`).

**Cause.** Reproduced outside the suite (a standalone script restarts the real server on the same port and then calls it with the global `fetch`). With Node's pooled keep-alive connections it failed in 4 of 60 restarts, 1 of 80, and 1 and 3 of 150 in two runs (`ECONNRESET` or `UND_ERR_SOCKET`), and a 400-restart run failed as well (first at restart 267). With `connection: close` on the requests it failed in 0 of 400 restarts (and 0 of 80 with a 30 ms wait after the restart instead). The client's pool reused a socket that the server had already closed: a stale keep-alive race, which HTTP clients are expected to handle by retrying idempotent requests (browsers do). It is not a readiness race: the server was listening before the first request, and a fresh connection never failed. It was a **shared resource**: every test helper (`api()` in the harness, and the same pattern in five other test files) used the process-wide connection pool across a server restart.

**A real defect found on the way.** The server's `stop()` cut every connection at once, including a request in progress: a client that had sent part of a request got `socket hang up` and the app dropped a write that was being answered. This is not what produced the test failure (the race above persists with the graceful stop: 1 and 3 of 150 in two runs), but it is an app defect and is fixed.

**Fixes.**
1. `stop()` is graceful: it stops accepting, ends event streams, closes idle connections, lets requests in progress finish (each connection closes with its response), and cuts off whatever remains after a grace period (3 s, `stopGraceMs`).
2. The test API helpers send `connection: close`, so no test shares a pooled socket across a restart. This is not a retry: a failure of the server to answer a fresh connection still fails the test.

**Coverage.** `tests/app/shutdown.test.ts` (5): a request in progress is answered in full and its write is committed, and the stop completes after it; a client that never finishes cannot hold the stop past the grace period; idle keep-alive connections are closed promptly; event streams end; 30 restarts on the same port each answer a fresh connection. Run against the old `stop()`: the first two fail (`socket hang up`; stopped after 0 ms instead of the grace period); the other three pass on the old code too, so they are guards, not proof of the fix. The restart test itself passed 25 of 25 separate runs afterwards and 3 of 3 full-suite runs, which supports but does not prove the fix; the proof is the controlled comparison above.

## 11. Verification round: the package.json change, and what it did to the baseline

`package.json` changed in one way in this round: `test:slow` now includes `tests/app/planner.slow.test.ts`. `package-lock.json` did not need to change.

**Effect, measured.** The app records the render sources (`code` includes the whole of `package.json`, `package-lock.json`, `tsconfig.json`, `remotion.config.ts` and `src/`) when a video is built. After the edit, the baseline's rebuild plan schedules **Final video: run**, reason "code: package.json changed", and its status report still read fresh, because the status report compares recorded input hashes and never looks at the working copy. So the editor showed green while the plan said the final video would be rebuilt. I did not leave that: the editor's out-of-date list now includes a final video whose render sources changed (`renderDrift` in the episode payload, `withRenderDrift`, tested), and the baseline shows **1 out of date**: "Final video: The app's render sources changed since it was built (code: package.json changed), about 28 s to 29 s (estimate)" (`phase5-evidence/after-13-baseline-render-sources-drift.png`).

**What I did not do.** The final video was **not rebuilt**. The MP4 and its record are unchanged (same build `b11-12-13`, same artifacts); only the app's judgement of it changed. A rebuild from the editor's **Rebuild…** would re-record the sources and re-render the final video from the existing narration and timing, with no model; it is a deliberate action and I left it to you.

**Dependency-design issue, separately.** Hashing whole `package.json` means metadata that cannot change a rendered pixel (the `scripts` block, `description`, `devDependencies`, `engines`) invalidates recorded videos, as this change did. A narrower definition would hash the fields that can affect the bundle (`dependencies`, `type`) plus the lockfile entries of the render dependencies (the installed `remotion` and `@remotion/renderer` versions are already recorded separately), and the `tsconfig.json` compiler options that affect JSX and module transpilation. I have **not** changed it: it alters what every recorded render depends on, it would itself change the recorded hash, and it needs your decision. Until then, any edit to `package.json`, including test metadata, will mark every recorded final video out of date, honestly but unnecessarily.

## 12. How accepted storyboard data connects to production

What is stored: for each planned scene, its narration lines (segment ids), scene type, intention, what is shown, Pip's actions, optional `params`, and where it came from. It lives in the plan, outside the episode document.

What exists now: `episodeSceneFor` turns a planned scene into the scene object the episode schema would hold, using that scene type's own schema, or reports why it cannot; `episodeScenesFromPlan` returns the full scene list only when the whole storyboard is ready. Tests show a ready storyboard converting to scenes that the episode schema accepts. **No screen or request applies them.**

How it will connect, and what is not yet scheduled:
* **Voice (Phase 6)** works on the episode's narration, which already exists once a script is accepted; it does not need the storyboard.
* **Applying the storyboard** would replace the stand-in scene with `episodeScenesFromPlan`'s result through `saveEpisode` with the current sequence number (so it is a revision, conflict-protected, and freshness works as for any edit). That step is the missing link. [05](05-implementation-plan.md) has no phase for it or for a scenes editor: the stepper's "Scenes" stage is not scheduled in Phases 6 to 8. It needs a place in the plan before a storyboard can reach a render; the rebuild blockers will keep saying so until it exists.
* After applying, the episode's layouts, the fit check, cues and beats are the existing Phase 3 machinery. Two things do not carry over automatically: layouts (defaults apply until chosen) and **Pip's actions and the "what is shown" text**, which are notes with no mapping to beats; a person turns them into beats.
* **Phase 7** (review, final render, approval) renders `episode.scenes`; once they are applied and every check passes there is no storyboard-specific obstacle.
* A **custom** scene becomes producible when a developer implements and registers it (a Tier 3 scene, [02 §11](02-product-spec.md#11-scene-controls-and-layouts)); it then joins `SCENE_TYPES`, and scenes planned as custom can be changed to it. An **unsupported** type is a choice to revisit, not a state to wait out.

## 13. Files

New: `app/planning.ts`; `app/shared/{plan,packet,importing,handoff,storyboard}.ts`; `app/ui/{Episodes,Planner,Research,Storyboard,Import}.tsx`; `tests/app/{packet,importing,planning}.test.ts`, `tests/app/planner.slow.test.ts`, `tests/app/planner-scenario.ts`; `scripts/phase5_demo_ui.ts`; `docs/studio/phase5-evidence/`.
Verification round: `app/server.ts` (graceful stop, drift in the episode payload), `app/jobs.ts` (`renderDrift`), `app/shared/{storyboard,packet,plan,importing,costs}.ts`, `app/ui/{Storyboard,Import,App}.tsx`, `package.json` (`test:slow`), the test files listed in section 4, and the test helpers (`tests/app/harness.ts` and the other API helpers).
Changed: `core/db.ts` (migration 3), `core/episodes.ts` (`createEpisode`, deferred projection, two permanent revision kinds), `app/server.ts` (routes), `app/plan.ts` (planning blockers), `app/ui/{App,Chrome,api,Outline,Inspector,History,labels}.ts(x)`, `app/ui/styles.css`, `app/shared/revisions.ts` (labels), docs.
Not touched: `package-lock.json`, `tsconfig.json`, `src/`, `core/timeline.ts`, `workers/`, `pipeline/`, `episodes/`, `reference/pip-voice/approved-v1/`, `prototypes/pip-scene-10x-v1/`. No commits were made. No model was loaded and nothing was rendered.
