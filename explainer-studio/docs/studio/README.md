# Explainer Studio: product planning

Planning documents for the local browser app, plus the status of implementation.
Phases 0, 1, 2 and 3 are done (Phases 2 and 3 await your review). Phase 4 (the editable preview and actionable edits) is **implemented, with its automated checks passing; your review is pending**, and its documented limits stand ([09](09-phase4-slice2.md)). Phase 5 (research, script, storyboard and manual ChatGPT import) is **implemented and verified by its automated checks; your review is pending** ([10](10-phase5-acceptance.md)). Phase 5B (Scenes: applying an accepted storyboard to the episode, scene controls, a labelled composition preview) was added before Phase 6 to close the storyboard-to-production link; it is **implemented, with its automated checks passing; your review is pending** ([11](11-phase5b-scenes.md)). Phase 6 (the Voice stage: per-episode sound settings, generating, re-rolling, auditioning and selecting takes, splitting and merging blocks, truthful engine state and measured estimates) is **implemented; its automated checks and one bounded real narration run are reported in [12](12-phase6-voice.md), and your review, including listening, is pending**. Phase 7 (review, final render, approval, export) is **implemented; its automated checks pass and one real draft-to-final demonstration is left awaiting your approval; no listening, viewing or approval is recorded** ([13](13-phase7-review.md)). Phase 8 (hardening and core-workflow acceptance: a separate project and journey, recovery and relocation, a clean-source-snapshot run, bundled fonts as the production default, app hardening, measurements, licence position) is **implemented and technically verified as recorded; nothing in it is human-approved** ([14](14-phase8-hardening.md)). The plan also records a future milestone for more than one production tool ([05](05-implementation-plan.md#future-milestone-more-than-one-production-tool-not-started-planning-only)); nothing is built for it.

| Doc | Contents |
|---|---|
| [01 Current-state audit](01-current-state-audit.md) | Working, experimental, missing; measured findings |
| [02 Product specification](02-product-spec.md) | Journey, review loop and approval, state and recovery, snapshots and invalidation, timing and alignment, quality checks, jobs, import, layouts, 1280 × 800 editor |
| [03 Navigation and editor mockup](03-navigation-and-editor-mockup.md) | Screens; interactive HTML in `mockups/` |
| [04 Architecture](04-architecture.md) | Single project store and recovery, voice-to-render hand-over, timeline decision, alignment evaluation; diagram in `diagrams/` |
| [05 Implementation plan](05-implementation-plan.md) | Phases 0 to 8 with acceptance criteria; Phase 0 and 1 results |
| [08 Phase 4, slice 1: editable preview](08-phase4-slice1.md) | The demo workspace and how to reopen it, the truthful preview, saving and recovery (with limits), measured results, what needs your eyes |
| [09 Phase 4, slice 2: actionable edits](09-phase4-slice2.md) | Rebuild plan, jobs tray, build preview pairing, revision recovery, measured results, the one real rebuild, limits |
| [10 Phase 5 acceptance](10-phase5-acceptance.md) | Episode drafts, research records, the manual ChatGPT handoff and import, the storyboard check: how it works, measured results, the recorded demonstration, limits |
| [11 Phase 5B: Scenes](11-phase5b-scenes.md) | Applying an accepted storyboard to the episode, the Pip cards scene, scene controls, the labelled composition preview, what each edit makes stale, the separate-draft demonstration, limits |
| [12 Phase 6: Voice](12-phase6-voice.md) | Per-episode sound settings, the Voice screen (takes, re-roll, selection, split and merge, engine state, estimates, listening sample), automated checks, one bounded real narration with measured times and the estimate comparison, limits, what is yours to judge |
| [13 Phase 7: Review, final render, approval, export](13-phase7-review.md) | Review notes and rounds, draft and final builds, production checks (measured, heuristic, partial, human), playback coverage, approval bound to file and input hashes, export of the exact approved bytes, measured results, the real demonstration, limits |
| `phase7-evidence/` | Phase 7 evidence: screenshots of the demonstration run through the real app and its recorded measurements |
| [16 The Pip Explains opening in the episode workflow](16-pip-opening-workflow.md) | The hook field, new-episode defaults (the chime once), the matching cover from the rendered opening (tracked, outdated after edits, in the export package), linking an episode to its planning document, and one disposable-project run through the real page |
| [15 Creative benchmark and review records](15-creative-benchmark-and-review-records.md) | The author's preferred visual benchmark (exact file and SHA-256), how it differs from the Phase 8 final output, the production guidance taken from it, and build-by-build review status |
| [14 Phase 8: Hardening](14-phase8-hardening.md) | The journey on a separate project, recovery and relocation (backup, restore, damage), the clean source snapshot, bundled fonts, hardening audit, measurements, licence position, the core-feature checklist and ranked limitations |
| `phase8-evidence/` | Phase 8 evidence: the journey (screenshots, run record, logs), audit, recovery comparisons, clean-snapshot run, measurements, demo refresh |
| `phase6-evidence/` | Phase 6 evidence: screenshots of the demonstration run through the real app and its recorded measurements |
| `phase5-evidence/` | Phase 5 evidence: screenshots of the demonstration run through the real app, and its recorded observations |
| `phase4-evidence/` | Phase 4 evidence: the preview-versus-render comparison sheet and numbers, timeline and note screenshots, the real-model hand-over report |
| [07 Phase 3 acceptance](07-phase3-acceptance.md) | Scene library, Pip performance as data, sound accents, caption emphasis, layouts and fit check, fonts, prototype reproduced through the pipeline, the context-window sample: measured results, what needs your eyes and ears, limits |
| [06 Phase 2 acceptance](06-phase2-acceptance.md) | Job runner, audio and render workers, timeline wrapper, alignment evaluation: results, measured resource use, limits |

## Changes in this revision

1. **Review loop.** Edit, draft render, review, revise, final mastered render, final approval, export. Export copies the approved file and never renders or masters. Any change to a hashed input voids approval. ([02 §2](02-product-spec.md#2-the-review-loop))
2. **Immutable snapshots.** Every job runs on a frozen snapshot; a job that finishes after inputs changed is kept as outdated and cannot replace the current or approved output. Dependency hashes now include assets, fonts, scene code, theme, narration, timing, sound mix and render settings. ([02 §4](02-product-spec.md#4-dependencies-invalidation-and-immutable-snapshots))
3. **Model hand-over and cancellation.** Qwen is unloaded and confirmed released (or its process is killed and confirmed gone) before a render starts; cancel stops the whole process tree and frees the heavy slot. The acceptance tests exercise the transition rather than comparing timestamps. ([02 §8](02-product-spec.md#8-jobs), [04](04-architecture.md#voice-to-render-transition), [05 Phase 2](05-implementation-plan.md))
4. **Alignment.** Local forced alignment is in the quality plan with three labelled timing sources (`aligned`, `estimated`, `manual`); no claim of perfect timing. Candidate evaluated, nothing installed. ([02 §6](02-product-spec.md#6-timing-and-alignment), [04](04-architecture.md#alignment-option-evaluation))
5. **One authority for project state.** The project database is the only authoritative store; `episode.json` is a projection; the separate journal is gone. Recovery protocol, backup and restore contents, and reference-safe cache cleanup are specified. ([04](04-architecture.md#project-state-store-and-recovery))
6. **Timeline.** The Python logic stays; a Node wrapper will call it. A port needs a concrete requirement. ([04](04-architecture.md#timeline-decision))
7. **Mockups.** The voice screen's engine state now matches its running job; preview guides no longer overlap content; new 1280 × 800 editor screens with collapsible panels and a resizable timeline; the review screen shows the draft, mastering, manual and approval states. The architecture diagram was updated and re-validated.
8. **Quality checks.** Acceptance checks for missing narration, caption and spoken-text mismatch, fonts, overflow and obscured content, mastering in the reviewed file, and manual listening and playback, each labelled measured, manual or limited. The spec does not claim custom scenes can be verified automatically. ([02 §7](02-product-spec.md#7-quality-checks))

## Implementation status

* **Phase 0** (done): regression fixtures from real data, template and README repair, declared dependencies, tested v1 to v2 migration. [Result](05-implementation-plan.md#phase-0-result).
* **Phase 1** (done): project store and recovery (SQLite, transactional saves, immutable revisions, content-addressed media, input snapshots, dependency hashes, stale and approval invalidation, external `episode.json` detection, backup and restore, reference-safe cleanup) and the rule that legacy commands never substitute a Kokoro voice for a Qwen episode. [Result, limits and plan changes](05-implementation-plan.md#phase-1-result). An independent review found four issues (restore path validation, cleanup preview with thinning, recovery from corrupt backups, lock behaviour when process inspection is unavailable); all are fixed with regression tests ([details](05-implementation-plan.md#review-fixes-independent-review-of-phase-1)).
* **Phase 2** (done, closed out; awaiting your listening and viewing review of the technical validation sample, whose visual style was rejected; the Pip prototype is the reference for Pip's character and performance; the preferred visual benchmark for explanatory storytelling is the slice 2 rebuild, see document 15): persistent job runner with attempts, immutable snapshots and truthful progress; one heavy job at a time (machine-wide since the Phase 8 closeout); Qwen narration with the approved Pip reference; block-level caching; thin wrapper around the Python timeline logic; forced alignment (aligner adopted, estimate kept as labelled fallback); Remotion render worker with progress, cancellation and isolated output; confirmed model unload before renders; restart recovery without orphans. Queued jobs run on the settings recorded when they were queued, and inputs this build cannot apply (manual timing, sound design, pauses inside a block) are rejected rather than ignored. A real timing, final mastered mix and final render run produced a playable validation sample with measured loudness, peak, sync and video properties. [Results, resource use and limits](06-phase2-acceptance.md).
* **Phase 3** (done; awaiting your viewing and listening review): scene library (`src/library/`) with the frozen Pip prototype scene registered unchanged; Pip's performance as data (the prototype's score equals the original `perform()` on every frame); narrow synthesized sound accents through the real mix; caption emphasis as ranges; `pip-paper` style (system fonts) and `pip-paper-bundled` (Inter and JetBrains Mono, OFL); layouts `card-over-pip`, `content-led`, `dense-pip` with a fit check; a dense Pip-style fixture; the prototype reproduced through the pipeline; a new simplified AI context-window sample with the approved Pip voice. [Results, measurements, limits and what needs your eyes and ears](07-phase3-acceptance.md).
* **Phase 4, slice 1** (built; awaiting your review): `./studio-app` opens a local editor on a persistent demo workspace seeded from the context-window sample: outline, the real Remotion Player on the last build with its saved audio, segment inspector (words, spoken text, emphasis, pause), read-only timeline, collapsible panels, truthful autosave with Retry and conflict handling, and plain explanations of what is out of date with measured cost estimates. In slice 1 it starts no jobs; slice 2 adds them. [Details, measurements, limits and recovery](08-phase4-slice1.md).
* **Phase 4, slice 2** (built; awaiting your review): edits become actionable on the demo workspace. **Rebuild…** shows what will run and what is reused (with an estimate or "Not measured") before anything starts, runs it on the existing persistent job runner, and previews the new build labelled with its revision. A jobs tray shows state, elapsed time, cancel and retry; interrupted jobs are offered a retry after a restart, never restarted automatically. History lists revisions (inspect, restore as a new revision) and builds. Real-project `init`/`adopt` stays paused. [Flow, measurements, limits](09-phase4-slice2.md).

From the project root: `npm test`.

## Generated output and disk use

Git history is small (about 25 MB, 5 commits). Most of the working folder is ignored, regenerable material, so deleting it changes the working-folder size but not the repository history.

| Kind | Where | Disposable? | Regenerate with |
|---|---|---|---|
| Dependencies | `node_modules/` (including `.cache` and the downloaded Chrome in `.remotion`), `.venv/`, `.venv-qwen/` | not removed by clean-up; large, slow to rebuild | `npm ci`; the Python requirements files |
| Model files | `~/.cache/huggingface/` (outside the repository) | not removed by clean-up; large downloads | the model downloads the workers name |
| Review outputs worth keeping until reviewed | `out/phase2/final`, `out/phase3/context-window-rev2` and `-rev1`, `out/phase3/prototype-pipeline`, `out/phase3/dense-fixture`, `out/phase3/boundary`, `out/phase3/fonts`, `out/phase3/parity-original` (summaries and sheets) | after your review | `scripts/phase3_run.ts`, `phase3_checkpoint.ts`, `phase3_parity.ts`, `phase3_boundary.py` |
| **Saved narration takes** | `out/phase3/context-window-rev2/takes/`, `out/phase2/integration/take-b*.wav` | **no**: not in Git and the only copies; use a project backup | none without regenerating (and reviewing) the narration; a copy of both is in the recovery backup `backups/pip-baseline-phase3-rev2/` at the repository root (checksums in its `BACKUP-RECORD.txt`) |
| Pipeline scratch | `build/` (join-fanout TTS cache is the input of `tests/fixtures/make_join_fanout_fixture.py`), `public/generated/` (used by the slow test), `src/generated/manifest.json` (used by the Remotion root), `public/_review/` (used by the contact-sheet composition) | not while those consumers exist | `./studio narrate`, `./studio render` |
| Bytecode, Finder files, logs, `.tmp/`, Remotion temp folders in the system temp directory | various | yes | recreated automatically |

`.gitignore` keeps generated media out of Git (`*.mp4`, `*.wav` and the like, `out/`, `build/`, `public/generated/`, `.studio/`, logs) and re-includes the approved sources: `reference/**`, `public/assets/**`, `public/library/**` (fonts, licences, the silent track) and `tests/fixtures/**`. Sample definitions in `samples/` are JSON and stay trackable. Media that was committed before the policy stays tracked.

## Decisions

Resolved (by you):

1. Existing tracked media and `episodes/my-topic` stay as they are.
2. The 0.3 s caption threshold stays. The historical regression fixtures are preserved; the 0.275 s caption in s17 is fixed when that episode is next edited.
3. Mastering targets are configurable, with −16 LUFS and −1.5 dBTP as initial defaults.
4. Alignment evaluation is left for Phase 2; no model download now.
5. Appropriately licensed fonts are bundled in Phase 3.
6. The applicable Remotion licence is recorded before any distribution (Phase 8 acceptance).

Resolved for Phase 2:

* The roughly 1.84 GB aligner download was authorised and used; the aligner is the default and the estimate is the labelled fallback.

Open:

* Whether to adopt the proposed bundled fonts (Inter and JetBrains Mono, installed for the `pip-paper-bundled` style, not yet approved) or keep the system stack; the loudness shortfall of the accent mixes ([Phase 3 §8](07-phase3-acceptance.md)).
* **Paused by you:** `init`/`adopt` on the real studio. The store and the runner have only been exercised on temporary projects.
