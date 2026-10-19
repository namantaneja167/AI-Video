# Phase 5B: Scenes (applying an accepted storyboard to the episode)

Status: implemented; the automated checks below passed in this session. **Your review is pending**, as it is for Phases 2 to 5. The Phase 5 verification round was accepted with your review still pending ([10](10-phase5-acceptance.md)). Phase 6 has not been started.

> **Correction (Phase 6).** Two statements below no longer hold. Sound events and mix settings now belong to each episode ([12](12-phase6-voice.md)), so the shared-events filtering of cues for other scene types is gone: a cue that names something an episode's scenes do not have is a validation error, never silently skipped. And the mix no longer follows scene timing for an episode with no sound accents; it follows timing only when that episode has accents. The table in section 3 and the paragraph under it describe the Phase 5B behaviour.

Why it exists: the journey is Idea, Research, Script, Storyboard, Voice, **Scenes**, Review, Render, Export. Until now nothing carried an accepted storyboard into the episode's own scenes, so a new Pip episode could never pass the production preflight. This phase closes that link and stops. It makes no narration, no video and no export, and it starts no job.

## 1. What to open

The app is running on the demo workspace (`./studio-app`, address and token as printed by that command). Open **Tokens in pieces**, the separate draft made for this phase (the approved `context-window` episode and the earlier `what-is-a-token` draft were only read). Storyboard tab: "Put these scenes into the episode". Scenes tab (stage 6 of the stepper): the controls, the composition preview and the production check. Screenshots and the machine-readable record of the run are in `phase5b-evidence/` (`demo-10-apply-preview.png` to `demo-14-preflight.png`, `demo-run.json`).

## 2. What was built

* **Apply an accepted storyboard.** "Preview what would change" lists every scene as new, changed, unchanged or removed; nothing is written by previewing. Only a complete, valid plan applies: every scene ready, every narration line in exactly one scene, in order. Otherwise the preview names each problem by scene: missing narration assignments, parameters that do not pass the scene type's own schema, unsupported types, custom scenes, cue words the narration does not contain, cards that do not fit the layout (with the numbers). Applying uses `episodeScenesFromPlan` and the normal validated episode save, in one transaction with the plan's own record that it was applied. It carries both sequence numbers (plan and episode) from the preview; if either has moved the apply is refused and nothing changes.
* **Existing scene work is never silently replaced.** If the episode already has scenes of its own that the apply would change, the preview says how many and the button stays disabled until a confirmation is ticked. In that case a revision of the current scenes is taken first (kind "Before scenes were applied", permanent), because ordinary edits are only checkpointed at intervals and the author's version would otherwise not be recoverable. Restoring it uses the existing History.
* **One bounded reusable Pip scene, `pip-cards`.** One to four cards of the author's text (heading, short body, optional moment of appearing) beside Pip, who does only the actions listed in its parameters: point, look, nod, hop, smile, each at a stated line and edge or spoken word. It is drawn from the approved Pip parts (the same performer and layouts as the Phase 3 scenes), in the warm-paper look, with three layouts (content-led, card over Pip, dense Pip). Its cue names (`card1..N`, `action1..M`, `voice_end`) depend on its parameters, so they are computed by a new module (`src/library/dynamicCues.ts`); the fingerprinted timeline logic files were not edited.
* **The dark legacy types are unsupported in a Pip-style episode** (`cards`, `kpi-mismatch`, `tables-lab`): the storyboard check says so and points to "Pip cards". The rejected table-lab look is not a default for anything.
* **Scenes step.** For each scene: its type, whether it is reusable, tied to particular content or needs custom implementation, and its state. Pip cards has fields for the title, cards, actions (each action's line and moment as selects, the spoken word chosen from the words of that line), layout, captions, showing Pip, and idle motion; the checks next to it are the real ones. Other scene types show no field controls and say so. Every scene has "Advanced: parameters as JSON", checked against the scene schema before it is taken. A scene is saved on its own button, through the normal save with the sequence check, merged into the newest episode; if that very scene changed elsewhere, nothing is saved and the unsaved edit stays.
* **Planning notes stay notes.** The storyboard's "what is shown" and "Pip" prose is labelled "planning note" on both screens, and the brief that is copied into ChatGPT says the same and asks for parameters and explicit actions. Nothing parses the prose into animation.
* **Truthful preview and freshness.** The composition preview is the real scenes on a clock estimated from word counts: labelled "Estimated timing · no audio · not a build", no audio is loaded, it includes unsaved changes, and it pauses (with the reason) while any scene's parameters are invalid instead of drawing it. The production check on the same screen is the rebuild planner's own preflight and step list (what would run); it is read-only.

## 3. What each edit makes out of date (measured with fake audio and render workers, real hashes and planner)

| Edit to a scene | Narration | Timing | Mix | Final video |
|---|---|---|---|---|
| Card text, idle motion | kept | kept | kept | rebuilt |
| Layout template, captions on or off | kept | kept | kept | rebuilt |
| A card appears on another word, or an action is added or moved | kept | rebuilt | rebuilt (see below) | rebuilt |
| The spoken words | rebuilt | rebuilt | rebuilt | rebuilt |

Why the mix follows the timing here: when a workspace records sound events, the mix hash conservatively follows the scene timing, even if no event lands in the episode. That rule was already there; this workspace records them, so it shows. Timing carries scene boundaries and cues, so for scenes whose cues depend on their parameters the timing hash now includes the scenes; for every other scene type it does not, which is why the baseline's recorded timing stays current.

**Sound events are shared by the workspace's episodes.** Found while testing: a new draft's mix was refused because the workspace's sound events are on cues of the context-window scene ("window_in"). Now an event whose cue no scene of the episode provides, but that another library scene type does, is left out of that episode's mix and is shown as a note in the preflight ("16 of the workspace's sound events are ... leaves them out"). A cue nobody provides is still a blocker in the preflight and a refusal in the mix. Per-episode sound events are not built (deferred).

## 4. Results (this session)

Measured; none of this says the result looks or sounds right.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0, no errors |
| `npm run test:ts` | 565 tests, 565 pass, 0 fail, 0 skipped |
| `npm run test:slow` (prototype, render, browser, rebuild, planner) | 44 tests, 44 pass, 0 fail, 0 skipped (it was 38 before this phase; the six added are the Phase 5B browser tests) |
| `tests/app/planner.slow.test.ts` again after the last wording and style edit of the UI | 13 of 13 pass |
| New focused tests | `tests/library/pipcards.test.ts` (14), `tests/app/scenes.test.ts` (23: refusals, preview writes nothing, one revision on the normal path, stale sequences refuse, atomic failure, replace needs a yes and the author's version is restorable, preflight reads the episode's scenes, freshness table above, estimate preview) |
| Browser (real Chrome, real app on a temporary workspace) | apply preview and apply through the page; refusals listed; stale preview refused and the other save kept; replace confirmation and restore; stale Scenes tab refused and its edit kept; invalid controls and raw JSON refused; preview paused for invalid parameters; labelled estimate with no job started |
| Demonstration on the demo workspace (`phase5b-evidence/demo-run.json`) | new draft "Tokens in pieces": accepted script (5 lines) and a ready storyboard of 3 Pip-cards scenes, applied through the page: preview 3 new, apply, 1 card heading edited and saved; revisions: create, scenes-apply; production preflight blockers: none; narration unchanged by the apply; 0 jobs started; 0 requests outside the app; 0 console errors; the only failed request is the deliberate invalid paste (422) |
| Approved baseline `context-window` after all of it | seq 15, document hash `59396c69a98c`, 6 revisions, 16 jobs and 16 artifacts, builds `b11-12-13` and others unchanged; take, timing and mix are current. The final video is reported as needing a rebuild (below) |

## 5. Limits

* **Render hashing is still conservative, and was not optimized.** The render sources hash covers all of `src/**` and `package.json`, so this phase's `src` changes make the baseline's recorded final video read as "needs a rebuild" (the plan says render:final "run"; nothing was run). Its video file and audio are unchanged and recoverable; a rebuild would record the new sources. Optimizing the hash is deferred as agreed.
* The Pip cards scene is the one reusable Pip scene: text cards and the five actions only. No images, charts, icons, other layouts or free-form motion; the other scenes (`context-window`, `pip-scene-10x`) are tied to their own content.
* The 16 recorded sound events belong to the context-window scene; episodes on Pip cards get no accents until per-episode sound events exist.
* The composition preview's times are guesses; the real timing, once narration exists, will differ, and the cue placement may differ with it. It has no audio and no captions beyond the estimated ones. It is not offered as a build.
* The storyboard's prose is not interpreted. A Pip action exists only if it is set in the scene's parameters.
* An ordinary scene save is an episode edit like any other: History checkpoints it at intervals, not each time. Only an apply over existing scene work forces a revision first.
* Estimates for "what would be rebuilt" come from the existing planner; for a new episode with no earlier run they are not measured.
* Not done here and not claimed: real narration, real rendering of the new scenes, any judgement of how Pip's actions look, 3D, Phase 6 onward.

## 6. For you to judge (not measured)

* Whether the apply preview and the confirmation read clearly, and whether "Planning note" labelling is enough.
* Whether the Pip cards scene looks right in the three layouts and whether its actions read as Pip's performance (open the Scenes tab of "Tokens in pieces" and play the estimate).
* Whether the one-reusable-scene scope is enough before Phase 6.

## 7. Files

New: `src/library/dynamicCues.ts`, `src/library/scenes/PipCards.tsx`, `src/library/scenes/pipCardsGeometry.ts`, `src/library/pip/scores/pipCards.ts`, `app/shared/estimate.ts`, `app/ui/Scenes.tsx`, `tests/app/scenes.test.ts`, `tests/app/scenes-scenario.ts`, `tests/library/pipcards.test.ts`, `scripts/phase5b_demo_ui.ts`, `phase5b-evidence/`. Changed: the scene schema and registry, the timing and mix handlers and hashes, the planner and storyboard checks, the apply routes, the Storyboard and stepper screens, the handoff brief, the plan and README. Protected paths (approved voice reference, the frozen prototype, `episodes/*`, `src/art`) are untouched.
